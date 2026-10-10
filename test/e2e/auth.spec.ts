import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN, createTestApp } from "../support/test-app.js";

test("refresh tokens rotate, are single-use, and replay revokes the session", async () => {
  const t = await createTestApp();
  const { api } = t;
  try {
    const first = await t.login(ADMIN.email, ADMIN.password);
    assert.equal(first.tokenType, "Bearer");
    assert.equal(first.expiresIn, 900);
    assert.equal(first.refreshExpiresIn, 30 * 24 * 3600);

    const second = (
      await api
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: first.refreshToken })
        .expect(200)
    ).body;
    assert.notEqual(second.refreshToken, first.refreshToken);
    await api
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${second.accessToken}`)
      .expect(200);

    // Replaying the used token is treated as theft: the family is revoked,
    // so even the newest refresh token stops working.
    await api
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    await api
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: second.refreshToken })
      .expect(401);
    const audit = await t.database.query(
      "SELECT 1 FROM audit_events WHERE action='REFRESH_TOKEN_REUSE_DETECTED'",
    );
    assert.equal(audit.rowCount, 1);

    // A separate login is a separate family and is unaffected.
    const other = await t.login(ADMIN.email, ADMIN.password);
    await api
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: other.refreshToken })
      .expect(200);

    for (const refreshToken of ["", "garbage", `${"0".repeat(36)}.x`])
      await api.post("/api/v1/auth/refresh").send({ refreshToken }).expect(401);
  } finally {
    await t.close();
  }
});

test("logout revokes every access and refresh token of the user", async () => {
  const t = await createTestApp();
  const { api } = t;
  try {
    const a = await t.login(ADMIN.email, ADMIN.password);
    const b = await t.login(ADMIN.email, ADMIN.password);
    await api
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${a.accessToken}`)
      .expect(204);
    await api
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${b.accessToken}`)
      .expect(401);
    for (const session of [a, b])
      await api
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: session.refreshToken })
        .expect(401);
  } finally {
    await t.close();
  }
});

test("expired refresh token is rejected", async () => {
  const t = await createTestApp();
  try {
    const session = await t.login(ADMIN.email, ADMIN.password);
    await t.database.query(
      "UPDATE refresh_tokens SET created_at=now()-interval '31 days', expires_at=now()-interval '1 second'",
    );
    await t.api
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  } finally {
    await t.close();
  }
});

test("BL-01: many users behind one IP can log in; one email is limited after 5 failures", async () => {
  const t = await createTestApp();
  const { api } = t;
  try {
    // 50 successful logins from the same IP within the minute.
    for (let i = 0; i < 50; i++)
      await api.post("/api/v1/auth/login").send(ADMIN).expect(200);

    const victim = { email: ADMIN.email, password: "wrong password 123" };
    for (let i = 0; i < 5; i++)
      await api.post("/api/v1/auth/login").send(victim).expect(401);
    const blocked = await api
      .post("/api/v1/auth/login")
      .send(victim)
      .expect(429);
    assert.match(blocked.body.message, /Too many failed attempts/);
    // Even the right password waits out the window: no oracle for guessing.
    await api.post("/api/v1/auth/login").send(ADMIN).expect(429);

    // Unknown emails are limited identically, so the limit reveals nothing.
    const ghost = {
      email: "nobody@test.example",
      password: "wrong password 123",
    };
    for (let i = 0; i < 5; i++)
      await api.post("/api/v1/auth/login").send(ghost).expect(401);
    await api.post("/api/v1/auth/login").send(ghost).expect(429);

    // Once the window has passed, the account works again.
    await t.database.query(
      "UPDATE login_throttle SET window_started_at = now() - interval '2 minutes'",
    );
    await api.post("/api/v1/auth/login").send(ADMIN).expect(200);
    const left = await t.database.query(
      "SELECT 1 FROM login_throttle WHERE email=$1",
      [ADMIN.email],
    );
    assert.equal(left.rowCount, 0, "success clears the counter");
  } finally {
    await t.close();
  }
});

test("NFR-05: every response carries a request id, echoed in errors", async () => {
  const t = await createTestApp();
  const { api } = t;
  try {
    const live = await api.get("/api/v1/health/live").expect(200);
    assert.match(live.headers["x-request-id"], /^[0-9a-f-]{36}$/);

    const upstream = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";
    const denied = await api
      .get("/api/v1/routes")
      .set("X-Request-Id", upstream)
      .expect(401);
    assert.equal(denied.headers["x-request-id"], upstream);
    assert.equal(denied.body.requestId, upstream);

    const forged = await api
      .get("/api/v1/health/live")
      .set("X-Request-Id", "not-a-uuid <script>")
      .expect(200);
    assert.notEqual(forged.headers["x-request-id"], "not-a-uuid <script>");
  } finally {
    await t.close();
  }
});
