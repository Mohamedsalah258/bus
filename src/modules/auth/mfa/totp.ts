import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 6238 TOTP: HMAC-SHA1, 6 digits, 30-second steps (authenticator-app defaults). */
export const TOTP_PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Accept one step either side for clock drift. */
const DRIFT_STEPS = 1;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function base32Encode(bytes: Buffer) {
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET.charAt((value << (5 - bits)) & 31);
  return out;
}

export function base32Decode(text: string) {
  const clean = text.replace(/=+$/, "").toUpperCase();
  let bits = 0,
    value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function currentStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpAt(secret: Buffer, step: number, digits = DIGITS) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", secret).update(counter).digest();
  const offset = hmac.at(-1)! & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Returns the matching step, or null. The caller must also require the step
 * to be newer than the last one accepted, so a code cannot be replayed.
 */
export function verifyTotp(secret: Buffer, code: string, nowMs = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentStep(nowMs);
  for (let delta = -DRIFT_STEPS; delta <= DRIFT_STEPS; delta++) {
    const expected = Buffer.from(totpAt(secret, now + delta));
    if (timingSafeEqual(expected, Buffer.from(code))) return now + delta;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}
