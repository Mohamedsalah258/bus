import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN, createTestApp, totp } from "../support/test-app.js";

test("BL-06: admins cannot work until a second factor is enrolled", async () => {
  const t = await createTestApp();
  const { api } = t;
  try {
    const token = await t.bearer(ADMIN.email, ADMIN.password);
    const blocked = await api
      .get("/api/v1/routes")
      .set("Authorization", token)
      .expect(403);
    assert.match(blocked.body.message, /Two-factor/);
    const me = (
      await api.get("/api/v1/auth/me").set("Authorization", token).expect(200)
    ).body;
    assert.deepEqual(
      { mfaRequired: me.mfaRequired, mfaEnabled: me.mfaEnabled },
      { mfaRequired: true, mfaEnabled: false },
    );

    // Activation needs setup first, and a correct code.
    await api
      .post("/api/v1/auth/mfa/activate")
      .set("Authorization", token)
      .send({ code: "123456" })
      .expect(400);
    const setup = (
      await api
        .post("/api/v1/auth/mfa/setup")
        .set("Authorization", token)
        .expect(200)
    ).body;
    assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\//);
    const wrong = totp(setup.secret, 5);
    await api
      .post("/api/v1/auth/mfa/activate")
      .set("Authorization", token)
      .send({ code: wrong })
      .expect(400);
    const activationCode = totp(setup.secret);
    const activated = (
      await api
        .post("/api/v1/auth/mfa/activate")
        .set("Authorization", token)
        .send({ code: activationCode })
        .expect(200)
    ).body;
    assert.equal(activated.recoveryCodes.length, 10);

    // Enrolment ended every session, including the one that enrolled.
    await api.get("/api/v1/auth/me").set("Authorization", token).expect(401);

    // The password alone now yields only a challenge, unusable as a token.
    const challenge = await t.login(ADMIN.email, ADMIN.password);
    assert.equal(challenge.mfaRequired, true);
    assert.equal(challenge.accessToken, undefined);
    await api
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${challenge.mfaToken}`)
      .expect(401);

    // The code used for activation cannot be replayed to sign in.
    await api
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: challenge.mfaToken, code: activationCode })
      .expect(401);
    const tokens = (
      await api
        .post("/api/v1/auth/mfa/verify")
        .send({ mfaToken: challenge.mfaToken, code: totp(setup.secret, 1) })
        .expect(200)
    ).body;
    await api
      .get("/api/v1/routes")
      .set("Authorization", `Bearer ${tokens.accessToken}`)
      .expect(200);

    await api
      .post("/api/v1/auth/mfa/setup")
      .set("Authorization", `Bearer ${tokens.accessToken}`)
      .expect(409);

    // A recovery code works exactly once and is audited.
    const [recovery] = activated.recoveryCodes;
    const second = await t.login(ADMIN.email, ADMIN.password);
    await api
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: second.mfaToken, recoveryCode: recovery.toUpperCase() })
      .expect(200);
    await api
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: second.mfaToken, recoveryCode: recovery })
      .expect(401);
    const used = await t.database.query(
      "SELECT 1 FROM audit_events WHERE action='MFA_RECOVERY_CODE_USED'",
    );
    assert.equal(used.rowCount, 1);

    // Exactly one of code / recoveryCode.
    await api
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: second.mfaToken })
      .expect(400);
  } finally {
    await t.close();
  }
});

test("BL-06: wrong codes are limited per account", async () => {
  const t = await createTestApp();
  const { api } = t;
  try {
    const { secret } = await t.enrollMfa(
      await t.bearer(ADMIN.email, ADMIN.password),
    );
    const challenge = await t.login(ADMIN.email, ADMIN.password);
    const bad = totp(secret, 7);
    for (let i = 0; i < 5; i++)
      await api
        .post("/api/v1/auth/mfa/verify")
        .send({ mfaToken: challenge.mfaToken, code: bad })
        .expect(401);
    await api
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: challenge.mfaToken, code: totp(secret) })
      .expect(429);
    await api
      .post("/api/v1/auth/mfa/verify")
      .send({ mfaToken: "garbage", code: "123456" })
      .expect(400);
  } finally {
    await t.close();
  }
});
