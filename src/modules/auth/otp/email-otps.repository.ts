import { Injectable } from "@nestjs/common";
import { Queryable } from "../../../database/database.types.js";
import {
  EMAIL_OTP_MAX_ATTEMPTS,
  EMAIL_OTP_TTL_MINUTES,
  EmailOtpPurpose,
  OtpSubject,
} from "./email-otp.js";

export interface ActiveEmailOtp {
  id: string;
  codeHash: string;
  attempts: number;
}

/** Column and value that identify a code's owner. Column names are fixed. */
const owner = (subject: OtpSubject) =>
  "userId" in subject
    ? { column: "user_id", value: subject.userId }
    : { column: "email", value: subject.email };

@Injectable()
export class EmailOtpsRepository {
  /** Issuing a code retires every earlier unused code of that purpose. */
  async issue(
    subject: OtpSubject,
    purpose: EmailOtpPurpose,
    codeHash: string,
    tx: Queryable,
  ) {
    const { column, value } = owner(subject);
    await tx.query(
      `UPDATE email_otps SET consumed_at=now() WHERE ${column}=$1 AND purpose=$2 AND consumed_at IS NULL`,
      [value, purpose],
    );
    await tx.query(
      `INSERT INTO email_otps(${column},purpose,code_hash,expires_at) VALUES($1,$2,$3,now() + make_interval(mins => $4))`,
      [value, purpose, codeHash, EMAIL_OTP_TTL_MINUTES],
    );
  }

  /** Codes issued recently, for the resend cooldown and hourly cap. */
  async recentIssues(
    subject: OtpSubject,
    purpose: EmailOtpPurpose,
    tx: Queryable,
  ) {
    const { column, value } = owner(subject);
    const { rows } = await tx.query<{
      lastHour: number;
      secondsSinceLast: number | null;
    }>(
      `SELECT count(*)::int AS "lastHour",
              EXTRACT(EPOCH FROM now() - max(created_at))::int AS "secondsSinceLast"
         FROM email_otps WHERE ${column}=$1 AND purpose=$2 AND created_at > now() - interval '1 hour'`,
      [value, purpose],
    );
    return rows[0]!;
  }

  /** The one live code, locked; null when absent, expired or exhausted. */
  async lockActive(
    subject: OtpSubject,
    purpose: EmailOtpPurpose,
    tx: Queryable,
  ) {
    const { column, value } = owner(subject);
    const { rows } = await tx.query<ActiveEmailOtp>(
      `SELECT id, code_hash AS "codeHash", attempts FROM email_otps
        WHERE ${column}=$1 AND purpose=$2 AND consumed_at IS NULL
          AND expires_at > now() AND attempts < $3
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [value, purpose, EMAIL_OTP_MAX_ATTEMPTS],
    );
    return rows[0] ?? null;
  }

  async recordWrongAttempt(id: string, tx: Queryable) {
    await tx.query("UPDATE email_otps SET attempts=attempts+1 WHERE id=$1", [
      id,
    ]);
  }

  async consume(id: string, tx: Queryable) {
    await tx.query("UPDATE email_otps SET consumed_at=now() WHERE id=$1", [id]);
  }
}
