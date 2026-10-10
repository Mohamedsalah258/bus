import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
} from "../../src/modules/auth/mfa/recovery-codes.js";
import { open, seal } from "../../src/modules/auth/mfa/secret-box.js";
import {
  base32Decode,
  base32Encode,
  otpauthUrl,
  totpAt,
  verifyTotp,
} from "../../src/modules/auth/mfa/totp.js";

// RFC 6238 Appendix B, SHA-1 secret "12345678901234567890".
const RFC_SECRET = Buffer.from("12345678901234567890");

test("TOTP matches the RFC 6238 test vectors", () => {
  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ];
  for (const [seconds, expected] of vectors)
    assert.equal(totpAt(RFC_SECRET, Math.floor(seconds / 30), 8), expected);
});

test("verifyTotp accepts one step of drift and nothing beyond", () => {
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 30_000);
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step), now), step);
  assert.equal(
    verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), now),
    step - 1,
  );
  assert.equal(
    verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 1), now),
    step + 1,
  );
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 2), now), null);
  for (const bad of ["", "12345", "1234567", "abcdef"])
    assert.equal(verifyTotp(RFC_SECRET, bad, now), null);
});

test("base32 round-trips arbitrary bytes", () => {
  for (let n = 0; n < 40; n++) {
    const bytes = randomBytes(n);
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  }
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
});

test("secret box round-trips and rejects tampering or a wrong key", () => {
  const key = randomBytes(32);
  const sealed = seal("JBSWY3DPEHPK3PXP", key);
  assert.equal(open(sealed, key), "JBSWY3DPEHPK3PXP");
  assert.notEqual(seal("same", key), seal("same", key), "random nonce");
  assert.throws(() => open(sealed, randomBytes(32)));
  const parts = sealed.split(".");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => open(parts.join("."), key));
});

test("recovery codes are distinct and normalized before hashing", () => {
  const codes = generateRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) assert.match(code, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
  assert.equal(
    hashRecoveryCode(" ABCDE-FGHJK "),
    hashRecoveryCode("abcde-fghjk"),
  );
});

test("otpauth URL carries the parameters authenticator apps expect", () => {
  const url = new URL(otpauthUrl("JBSWY3DPEHPK3PXP", "a@b.c", "BSU Bus"));
  assert.equal(url.protocol, "otpauth:");
  assert.equal(url.searchParams.get("secret"), "JBSWY3DPEHPK3PXP");
  assert.equal(url.searchParams.get("issuer"), "BSU Bus");
  assert.equal(url.searchParams.get("digits"), "6");
});
