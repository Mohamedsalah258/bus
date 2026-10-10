import { Injectable } from "@nestjs/common";
import { Database } from "../../../database/database.service.js";
import {
  LOGIN_FAILURE_WINDOW_SECONDS,
  LOGIN_MAX_FAILURES,
} from "../auth.constants.js";

/**
 * Fixed-window failure counter, stored in PostgreSQL so every API instance
 * enforces the same limit (NFR-02 for sign-in). Keys are a normalized email
 * for passwords and `mfa:<user id>` for second-factor codes.
 */
@Injectable()
export class LoginThrottleRepository {
  constructor(private readonly db: Database) {}

  async isBlocked(email: string) {
    const result = await this.db.query(
      "SELECT 1 FROM login_throttle WHERE email=$1 AND failures>=$2 AND window_started_at > now() - make_interval(secs => $3)",
      [email, LOGIN_MAX_FAILURES, LOGIN_FAILURE_WINDOW_SECONDS],
    );
    return Boolean(result.rowCount);
  }

  async recordFailure(email: string) {
    await this.db.query(
      `INSERT INTO login_throttle(email,failures,window_started_at) VALUES($1,1,now())
       ON CONFLICT(email) DO UPDATE SET
         failures = CASE WHEN login_throttle.window_started_at <= now() - make_interval(secs => $2) THEN 1 ELSE login_throttle.failures + 1 END,
         window_started_at = CASE WHEN login_throttle.window_started_at <= now() - make_interval(secs => $2) THEN now() ELSE login_throttle.window_started_at END`,
      [email, LOGIN_FAILURE_WINDOW_SECONDS],
    );
    // Keep the table bounded even under email-spraying attacks.
    await this.db.query(
      "DELETE FROM login_throttle WHERE window_started_at < now() - interval '1 day'",
    );
  }

  async clear(email: string) {
    await this.db.query("DELETE FROM login_throttle WHERE email=$1", [email]);
  }
}
