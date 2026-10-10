import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module.js";
import { Database } from "../../src/database/database.service.js";
import { BookingsService } from "../../src/modules/bookings/bookings.service.js";
import { RoutesService } from "../../src/modules/routes/routes.service.js";
import { TripsService } from "../../src/modules/trips/trips.service.js";
import { migrate } from "../../scripts/migrate.js";

const url = process.env.TEST_DATABASE_URL;
test(
  "real PostgreSQL: 20 concurrent round trips on 10+10 seats give exactly 10 full pairs, no orphan leg",
  { skip: !url },
  async () => {
    if (!new URL(url!).pathname.endsWith("_test"))
      throw new Error("Use an isolated *_test database.");
    process.env.DATABASE_URL = url;
    process.env.JWT_SECRET = "integration-only-".repeat(4);
    process.env.MFA_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
    await migrate(url!);
    const app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const db = app.get(Database);
    try {
      await db.query(
        "TRUNCATE news_posts,group_trip_requests,complaint_messages,complaints,schedule_templates,service_exceptions,notifications,email_otps,subscription_payments,subscription_plans,mfa_recovery_codes,route_eligible_categories,refresh_tokens,login_throttle,audit_events,bookings,trips,subscriptions,route_stops,routes,drivers,vehicles,seasons,users,beneficiary_categories,faculties CASCADE",
      );
      const admin = (
        await db.query(
          "INSERT INTO users(email,name,password_hash,role) VALUES('a@t.example','A','x','ADMIN') RETURNING id",
        )
      ).rows[0].id;
      const cat = (
        await db.query(
          "INSERT INTO beneficiary_categories(code,name) VALUES('EMPLOYEE','E') RETURNING id",
        )
      ).rows[0].id;
      const route = await app.get(RoutesService).create(
        {
          name: "R",
          stops: [{ name: "Start" }, { name: "End" }],
          eligibleCategoryIds: [cat],
        },
        admin,
      );
      const season = (
        await db.query(
          "INSERT INTO seasons(name,starts_on,ends_on) VALUES('S','2000-01-01','2099-12-31') RETURNING id",
        )
      ).rows[0].id;
      const mk = async (
        plate: string,
        driver: string,
        direction: "OUTBOUND" | "RETURN",
        startH: number,
      ) => {
        const v = (
          await db.query(
            "INSERT INTO vehicles(plate,capacity) VALUES($1,10) RETURNING id",
            [plate],
          )
        ).rows[0].id;
        const d = (
          await db.query("INSERT INTO drivers(name) VALUES($1) RETURNING id", [
            driver,
          ])
        ).rows[0].id;
        const base = Date.now() + 86_400_000 + startH * 3_600_000;
        const iso = (h: number) => new Date(base + h * 3_600_000).toISOString();
        return app.get(TripsService).create(
          {
            routeId: route.id,
            vehicleId: v,
            driverId: d,
            direction,
            capacity: 10,
            departureAt: iso(0),
            arrivalAt: iso(1),
            bookingClosesAt: iso(-1),
            cancellationClosesAt: iso(-1),
          },
          admin,
        );
      };
      const out = await mk("V1", "D1", "OUTBOUND", 0);
      const back = await mk("V2", "D2", "RETURN", 8);
      const users: string[] = [];
      for (let i = 0; i < 20; i++) {
        const id = (
          await db.query(
            "INSERT INTO users(email,name,password_hash,email_verified_at) VALUES($1,'M','x',now()) RETURNING id",
            [`u${i}@t.example`],
          )
        ).rows[0].id;
        await db.query(
          "INSERT INTO subscriptions(user_id,season_id,route_id,status) VALUES($1,$2,$3,'APPROVED')",
          [id, season, route.id],
        );
        users.push(id);
      }
      const stop = route.stops[0]!.id;
      const results = await Promise.allSettled(
        users.map((u) =>
          app.get(BookingsService).createRoundTrip(
            {
              outbound: {
                tripId: out.id,
                boardingStopId: stop,
                idempotencyKey: randomUUID(),
              },
              return: {
                tripId: back.id,
                boardingStopId: stop,
                idempotencyKey: randomUUID(),
              },
            },
            u,
          ),
        ),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 10);
      const counts = await db.query(
        `SELECT (SELECT count(*)::int FROM bookings WHERE trip_id=$1 AND status='CONFIRMED') AS o,
                (SELECT count(*)::int FROM bookings WHERE trip_id=$2 AND status='CONFIRMED') AS r,
                (SELECT count(*)::int FROM (SELECT pair_id FROM bookings GROUP BY pair_id HAVING count(*) <> 2) x) AS orphans`,
        [out.id, back.id],
      );
      assert.deepEqual(counts.rows[0], { o: 10, r: 10, orphans: 0 });
    } finally {
      await app.close();
    }
  },
);
