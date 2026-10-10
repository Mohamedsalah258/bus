import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module.js";
import { Database } from "../../src/database/database.service.js";
import { BookingsService } from "../../src/modules/bookings/bookings.service.js";
import { RoutesService } from "../../src/modules/routes/routes.service.js";
import { SeasonsService } from "../../src/modules/seasons/seasons.service.js";
import { TripsService } from "../../src/modules/trips/trips.service.js";
import { migrate } from "../../scripts/migrate.js";

const url = process.env.TEST_DATABASE_URL;
test(
  "real PostgreSQL: 100 contenders for 10 seats, assignment conflicts and idempotency (NFR-01)",
  { skip: !url },
  async () => {
    if (!new URL(url!).pathname.endsWith("_test"))
      throw new Error("Use an isolated database with a name ending in _test.");
    process.env.DATABASE_URL = url;
    process.env.JWT_SECRET = "integration-only-".repeat(4);
    process.env.MFA_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
    await migrate(url!);
    await migrate(url!); // also verifies migration replay
    const app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const db = app.get(Database);
    const routes = app.get(RoutesService);
    const seasons = app.get(SeasonsService);
    const trips = app.get(TripsService);
    const bookings = app.get(BookingsService);
    try {
      await db.query(
        "TRUNCATE news_posts,group_trip_requests,complaint_messages,complaints,schedule_templates,service_exceptions,notifications,email_otps,subscription_payments,subscription_plans,mfa_recovery_codes,route_eligible_categories,refresh_tokens,login_throttle,audit_events,bookings,trips,subscriptions,route_stops,routes,drivers,vehicles,seasons,users,beneficiary_categories,faculties CASCADE",
      );
      const actor = randomUUID();
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,'admin@test.example','Admin','unused','ADMIN')",
        [actor],
      );
      const category = (
        await db.query(
          "INSERT INTO beneficiary_categories(code,name) VALUES('EMPLOYEE','Employee') RETURNING id",
        )
      ).rows[0].id;
      const route = await routes.create(
        {
          name: "Concurrency",
          stops: [{ name: "Start" }, { name: "End" }],
          eligibleCategoryIds: [category],
        },
        actor,
      );
      const vehicle = (
        await db.query(
          "INSERT INTO vehicles(plate,capacity) VALUES('TEST',10) RETURNING id",
        )
      ).rows[0].id;
      const driver = (
        await db.query(
          "INSERT INTO drivers(name) VALUES('Driver') RETURNING id",
        )
      ).rows[0].id;
      const season = (
        await seasons.create({
          name: "Test",
          startsOn: "2000-01-01",
          endsOn: "2099-12-31",
        })
      ).id;
      const base = Date.now() + 86400000;
      const iso = (n: number) => new Date(base + n).toISOString();
      const dto = {
        routeId: route.id,
        vehicleId: vehicle,
        driverId: driver,
        direction: "OUTBOUND" as const,
        capacity: 10,
        departureAt: iso(0),
        arrivalAt: iso(3600000),
        bookingClosesAt: iso(-3600000),
        cancellationClosesAt: iso(-3600000),
      };
      const assignments = await Promise.allSettled([
        trips.create(dto, actor),
        trips.create(dto, actor),
      ]);
      assert.equal(
        assignments.filter((x) => x.status === "fulfilled").length,
        1,
      );
      const trip = (
        assignments.find(
          (x) => x.status === "fulfilled",
        ) as PromiseFulfilledResult<any>
      ).value;
      const users: string[] = [];
      for (let i = 0; i < 100; i++) {
        const id = randomUUID();
        users.push(id);
        await db.query(
          "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Member','unused')",
          [id, `user${i}@test.example`],
        );
        await db.query(
          "INSERT INTO subscriptions(user_id,season_id,route_id,status) VALUES($1,$2,$3,'APPROVED')",
          [id, season, route.id],
        );
      }
      const payload = {
        tripId: trip.id,
        boardingStopId: route.stops[0].id,
        idempotencyKey: randomUUID(),
      };
      const attempts = await Promise.allSettled(
        users.map((u) =>
          bookings.create({ ...payload, idempotencyKey: randomUUID() }, u),
        ),
      );
      const winners = attempts.filter(
        (x): x is PromiseFulfilledResult<any> => x.status === "fulfilled",
      );
      assert.equal(winners.length, 10);
      assert.equal(
        Number(
          (
            await db.query(
              "SELECT count(*) FROM bookings WHERE status='CONFIRMED'",
            )
          ).rows[0].count,
        ),
        10,
      );
      assert.equal(new Set(winners.map((w) => w.value.userId)).size, 10);
      for (const winner of winners)
        await bookings.cancel(winner.value.id, winner.value.userId);
      const repeats = await Promise.all(
        Array.from({ length: 10 }, () => bookings.create(payload, users[0])),
      );
      assert.equal(new Set(repeats.map((x) => x.id)).size, 1);
      assert.equal(
        Number(
          (
            await db.query(
              "SELECT count(*) FROM bookings WHERE status='CONFIRMED'",
            )
          ).rows[0].count,
        ),
        1,
      );
    } finally {
      await app.close();
    }
  },
);
