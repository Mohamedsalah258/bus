import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "../../src/modules/auth/password.js";

test("passwords use distinct salts and reject wrong values", async () => {
  const a = await hashPassword("correct password 123");
  const b = await hashPassword("correct password 123");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("correct password 123", a), true);
  assert.equal(await verifyPassword("wrong", a), false);
  assert.equal(await verifyPassword("wrong", "malformed"), false);
});

test("dummy hash is well-formed but never matches", async () => {
  assert.equal(
    await verifyPassword("anything at all", DUMMY_PASSWORD_HASH),
    false,
  );
});
