import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  formatRefreshToken,
  newRefreshSecret,
  parseRefreshToken,
  secretMatches,
} from "../../src/modules/auth/tokens/refresh-token.js";

test("refresh token round-trips and only the hash is comparable", () => {
  const id = randomUUID();
  const { secret, hash } = newRefreshSecret();
  assert.notEqual(secret, hash);
  const parsed = parseRefreshToken(formatRefreshToken(id, secret));
  assert.deepEqual(parsed, { id, secret });
  assert.equal(secretMatches(secret, hash), true);
  assert.equal(secretMatches(newRefreshSecret().secret, hash), false);
});

test("malformed refresh tokens are rejected before any lookup", () => {
  for (const token of ["", "abc", `${randomUUID()}.short`, `${randomUUID()}`])
    assert.equal(parseRefreshToken(token), null);
});
