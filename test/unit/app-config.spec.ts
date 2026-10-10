import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAppConfig } from "../../src/config/app-config.js";

const base = {
  DATABASE_URL: "postgresql://localhost/test",
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

test("rejects a short or placeholder JWT secret", () => {
  assert.throws(() => loadAppConfig({ ...base, JWT_SECRET: "short" }));
  assert.throws(() =>
    loadAppConfig({
      ...base,
      JWT_SECRET: "REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS",
    }),
  );
});

test("rejects public Swagger in production", () => {
  assert.throws(() =>
    loadAppConfig({
      ...base,
      JWT_SECRET: "s".repeat(64),
      NODE_ENV: "production",
      SWAGGER_ENABLED: "true",
    }),
  );
});

test("rejects wildcard or non-origin CORS entries", () => {
  for (const CORS_ORIGINS of ["*", "http://a.example/path"])
    assert.throws(() =>
      loadAppConfig({ ...base, JWT_SECRET: "s".repeat(64), CORS_ORIGINS }),
    );
});

test("defaults port to 3000", () => {
  assert.equal(
    loadAppConfig({ ...base, JWT_SECRET: "s".repeat(64) }).port,
    3000,
  );
});

test("trust proxy is an explicit hop count, never `true`", () => {
  const ok = { ...base, JWT_SECRET: "s".repeat(64) };
  assert.equal(loadAppConfig(ok).trustProxyHops, 0);
  assert.equal(
    loadAppConfig({ ...ok, TRUST_PROXY_HOPS: "1" }).trustProxyHops,
    1,
  );
  for (const TRUST_PROXY_HOPS of ["true", "-1", "6", "1.5"])
    assert.throws(() => loadAppConfig({ ...ok, TRUST_PROXY_HOPS }));
});

test("MFA encryption key must be exactly 32 bytes", () => {
  const ok = { ...base, JWT_SECRET: "s".repeat(64) };
  for (const MFA_ENCRYPTION_KEY of [
    "",
    "short",
    Buffer.alloc(16).toString("base64"),
  ])
    assert.throws(() => loadAppConfig({ ...ok, MFA_ENCRYPTION_KEY }));
});
