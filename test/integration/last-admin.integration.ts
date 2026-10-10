import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module.js";
import { Database } from "../../src/database/database.service.js";
import { UserManagementService } from "../../src/modules/user-management/user-management.service.js";
import { migrate } from "../../scripts/migrate.js";

const url = process.env.TEST_DATABASE_URL;
test(
  "real PostgreSQL: two admins deactivating each other at once leaves exactly one admin",
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
    const users = app.get(UserManagementService);
    try {
      for (let round = 0; round < 20; round++) {
        await db.query(
          "TRUNCATE news_posts,group_trip_requests,complaint_messages,complaints,schedule_templates,service_exceptions,notifications,email_otps,subscription_payments,subscription_plans,mfa_recovery_codes,route_eligible_categories,refresh_tokens,login_throttle,audit_events,bookings,trips,subscriptions,route_stops,routes,drivers,vehicles,seasons,users,beneficiary_categories,faculties CASCADE",
        );
        const ids = (
          await db.query(
            "INSERT INTO users(email,name,password_hash,role) VALUES('a@t.example','A','x','ADMIN'),('b@t.example','B','x','ADMIN') RETURNING id",
          )
        ).rows.map((r: { id: string }) => r.id);
        const [a, b] = ids as [string, string];
        const results = await Promise.allSettled([
          users.changeStatus(b, { active: false, reason: "race" }, a),
          users.changeStatus(a, { active: false, reason: "race" }, b),
        ]);
        assert.equal(
          results.filter((r) => r.status === "fulfilled").length,
          1,
          `round ${round}`,
        );
        const remaining = await db.query(
          "SELECT count(*)::int AS n FROM users WHERE role='ADMIN' AND active",
        );
        assert.equal(remaining.rows[0].n, 1, `round ${round}`);
      }
    } finally {
      await app.close();
    }
  },
);
