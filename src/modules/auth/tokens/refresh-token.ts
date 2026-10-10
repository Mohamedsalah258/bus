import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque refresh token: `<row id>.<43-char secret>`.
 * The id locates the row; only SHA-256(secret) is stored.
 */
const FORMAT =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export function newRefreshSecret() {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: hashSecret(secret) };
}

export function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export function formatRefreshToken(id: string, secret: string) {
  return `${id}.${secret}`;
}

export function parseRefreshToken(token: string) {
  const match = FORMAT.exec(token);
  return match ? { id: match[1]!, secret: match[2]! } : null;
}

export function secretMatches(secret: string, storedHash: string) {
  const actual = Buffer.from(hashSecret(secret), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
