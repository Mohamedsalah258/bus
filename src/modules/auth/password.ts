import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const KEY_LENGTH = 64;

/** Placeholder hash so unknown accounts still pay the KDF cost. */
export const DUMMY_PASSWORD_HASH =
  "00000000000000000000000000000000:" + "00".repeat(KEY_LENGTH);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await derive(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [salt, hex] = encoded.split(":");
  if (!salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const actual = (await derive(password, salt, KEY_LENGTH)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hex, "hex"));
}
