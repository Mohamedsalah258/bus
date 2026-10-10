import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const EmailOtpPurpose = {
  VerifyEmail: "VERIFY_EMAIL",
  ResetPassword: "RESET_PASSWORD",
  /** Password-free sign-in; addressed to an email, account or not. */
  SignIn: "SIGN_IN",
  /** Sent to the NEW address; the account changes only after it is entered. */
  ChangeEmail: "CHANGE_EMAIL",
} as const;
export type EmailOtpPurpose =
  (typeof EmailOtpPurpose)[keyof typeof EmailOtpPurpose];

export const EMAIL_OTP_TTL_MINUTES = 10;
export const EMAIL_OTP_MAX_ATTEMPTS = 5;
/** Minimum gap between two codes for one account, and an hourly cap. */
export const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60;
export const EMAIL_OTP_MAX_PER_HOUR = 5;

export function generateEmailOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Keyed hash: a 6-digit code has only a million values, so a plain hash of a
 * leaked row could be brute-forced offline. The key never leaves the server.
 */
/** Who a code belongs to: an account, or (for sign-in) an email address. */
export type OtpSubject = { userId: string } | { email: string };

export const subjectKey = (subject: OtpSubject) =>
  "userId" in subject ? subject.userId : `email:${subject.email}`;

export function hashEmailOtp(
  key: string | Buffer,
  subject: string,
  purpose: EmailOtpPurpose,
  code: string,
) {
  return createHmac("sha256", key)
    .update(`${subject}:${purpose}:${code}`)
    .digest("hex");
}

/** Purpose-specific key derived from the server secret (key separation). */
export function deriveEmailOtpKey(serverSecret: string) {
  return createHmac("sha256", serverSecret).update("email-otp:v1").digest();
}

export function emailOtpMatches(expectedHash: string, actualHash: string) {
  const a = Buffer.from(expectedHash, "hex");
  const b = Buffer.from(actualHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
