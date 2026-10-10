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
  "real PostgreSQL: cancelling a trip during a booking rush leaves no confirmed booking behind",
  { skip: !url },
  async () => {
    if (!new URL(url!).pathname.endsWith("_test"))
      throw new Error("Use an isolated database with a name ending in _test.");
    process.env.DATABASE_URL = url;
    process.env.JWT_SECRET = "integration-only-".repeat(4);
    process.env.MFA_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
    await migrate(url!);
    const app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const db = app.get(Database);
    const routes = app.get(RoutesService);
    const trips = app.get(TripsService);
    const bookings = app.get(BookingsService);
    try {
      for (let round = 0; round < 5; round++) {
        await db.query(
          "TRUNCATE news_posts,group_trip_requests,complaint_messages,complaints,schedule_templates,service_exceptions,notifications,email_otps,subscription_payments,subscription_plans,mfa_recovery_codes,route_eligible_categories,refresh_tokens,login_throttle,audit_events,bookings,trips,subscriptions,route_stops,routes,drivers,vehicles,seasons,users,beneficiary_categories,faculties CASCADE",
        );
        const admin = (
          await db.query(
            "INSERT INTO users(email,name,password_hash,role) VALUES('admin@t.example','Admin','x','ADMIN') RETURNING id",
          )
        ).rows[0].id;
        const category = (
          await db.query(
            "INSERT INTO beneficiary_categories(code,name) VALUES('EMPLOYEE','E') RETURNING id",
          )
        ).rows[0].id;
        const route = await routes.create(
          {
            name: "R",
            stops: [{ name: "Start" }, { name: "End" }],
            eligibleCategoryIds: [category],
          },
          admin,
        );
        const season = (
          await db.query(
            "INSERT INTO seasons(name,starts_on,ends_on) VALUES('S','2000-01-01','2099-12-31') RETURNING id",
          )
        ).rows[0].id;
        const vehicle = (
          await db.query(
            "INSERT INTO vehicles(plate,capacity) VALUES('V',50) RETURNING id",
          )
        ).rows[0].id;
        const driver = (
          await db.query("INSERT INTO drivers(name) VALUES('D') RETURNING id")
        ).rows[0].id;
        const base = Date.now() + 86_400_000;
        const iso = (n: number) => new Date(base + n).toISOString();
        const trip = await trips.create(
          {
            routeId: route.id,
            vehicleId: vehicle,
            driverId: driver,
            direction: "OUTBOUND" as const,
            capacity: 50,
            departureAt: iso(0),
            arrivalAt: iso(3_600_000),
            bookingClosesAt: iso(-3_600_000),
            cancellationClosesAt: iso(-3_600_000),
          },
          admin,
        );
        const users: string[] = [];
        for (let i = 0; i < 30; i++) {
          const id = (
            await db.query(
              "INSERT INTO users(email,name,password_hash,email_verified_at) VALUES($1,'M','x',now()) RETURNING id",
              [`u${i}@t.example`],
            )
          ).rows[0].id;
          users.push(id);
          await db.query(
            "INSERT INTO subscriptions(user_id,season_id,route_id,status) VALUES($1,$2,$3,'APPROVED')",
            [id, season, route.id],
          );
        }
        const rush = users.map((u) =>
          bookings.create(
            {
              tripId: trip.id,
              boardingStopId: route.stops[0]!.id,
              idempotencyKey: randomUUID(),
            },
            u,
          ),
        );
        // Cancel in the middle of the rush.
        rush.splice(
          15,
          0,
          trips.cancel(trip.id, "Road closed", admin) as never,
        );
        await Promise.allSettled(rush);

        const left = await db.query(
          "SELECT count(*)::int AS n FROM bookings WHERE trip_id=$1 AND status='CONFIRMED'",
          [trip.id],
        );
        assert.equal(
          left.rows[0].n,
          0,
          `round ${round}: confirmed booking on a cancelled trip`,
        );
        const status = await db.query("SELECT status FROM trips WHERE id=$1", [
          trip.id,
        ]);
        assert.equal(status.rows[0].status, "CANCELLED");
        // Every booking that got in before the cancel was told why.
        const cancelled = await db.query(
          "SELECT count(*)::int AS n FROM bookings WHERE trip_id=$1 AND status='CANCELLED_BY_ADMIN'",
          [trip.id],
        );
        const mails = await db.query(
          "SELECT count(*)::int AS n FROM notifications WHERE template='BOOKING_CANCELLED_BY_ADMIN'",
        );
        assert.equal(mails.rows[0].n, cancelled.rows[0].n);
      }
    } finally {
      await app.close();
    }
  },
);
