import { createHash, randomInt } from "node:crypto";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i
export const RECOVERY_CODE_COUNT = 10;

/** `xxxxx-xxxxx`: about 49 bits each, shown once, stored only as hashes. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const part = () =>
    Array.from({ length: 5 }, () =>
      ALPHABET.charAt(randomInt(ALPHABET.length)),
    ).join("");
  return Array.from({ length: count }, () => `${part()}-${part()}`);
}

export function normalizeRecoveryCode(code: string) {
  return code.trim().toLowerCase().replace(/\s+/g, "");
}

export function hashRecoveryCode(code: string) {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}
