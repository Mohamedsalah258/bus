import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NotificationDispatcher } from "../../src/modules/notifications/notification.dispatcher.js";
import { createTestApp, FakeMailer } from "../support/test-app.js";

async function catalog(t: Awaited<ReturnType<typeof createTestApp>>) {
  const admin = await t.adminBearer();
  const faculty = (
    await t.api
      .post("/api/v1/faculties")
      .set("Authorization", admin)
      .send({ name: "Science" })
      .expect(201)
  ).body;
  const category = await t.createCategory("EMPLOYEE", "موظف");
  return { facultyId: faculty.id as string, categoryId: category.id };
}

test("BL-05: email verification code — wrong tries, exhaustion, cooldown, resend", async () => {
  const t = await createTestApp();
  const { api, database } = t;
  try {
    const { facultyId, categoryId } = await catalog(t);
    const email = "new@test.example";
    await api
      .post("/api/v1/auth/register")
      .send({
        email,
        password: "member test password",
        name: "New",
        facultyId,
        categoryId,
      })
      .expect(201);
    const token = await t.bearer(email, "member test password");
    const me = (
      await api.get("/api/v1/auth/me").set("Authorization", token).expect(200)
    ).body;
    assert.equal(me.emailVerified, false);

    const right = await t.emailCode(email);
    const wrong = right === "000000" ? "111111" : "000000";
    const verify = (code: string) =>
      api
        .post("/api/v1/auth/email/verify")
        .set("Authorization", token)
        .send({ code });
    for (let i = 0; i < 5; i++) await verify(wrong).expect(400);
    // Five wrong tries spend the code: even the right one is refused now.
    await verify(right).expect(400);

    // A new code is limited to one a minute.
    await api
      .post("/api/v1/auth/email/resend")
      .set("Authorization", token)
      .expect(429);
    await database.query(
      "UPDATE email_otps SET created_at = created_at - interval '2 minutes'",
    );
    await api
      .post("/api/v1/auth/email/resend")
      .set("Authorization", token)
      .expect(204);
    const fresh = await t.emailCode(email);
    await verify(fresh).expect(204);
    await verify(fresh).expect(400); // single use
    await api
      .post("/api/v1/auth/email/resend")
      .set("Authorization", token)
      .expect(400);
    const after = (
      await api.get("/api/v1/auth/me").set("Authorization", token).expect(200)
    ).body;
    assert.equal(after.emailVerified, true);

    // An expired code is refused.
    await database.query(
      "UPDATE email_otps SET expires_at = now() - interval '1 second'",
    );
  } finally {
    await t.close();
  }
});

test("BL-05: password recovery by emailed code never reveals whether an account exists", async () => {
  const t = await createTestApp();
  const { api, database } = t;
  try {
    const { facultyId, categoryId } = await catalog(t);
    const email = "member@test.example";
    const oldSession = await t.registerMember({ email, facultyId, categoryId });

    const unknown = await api
      .post("/api/v1/auth/password/forgot")
      .send({ email: "nobody@test.example" })
      .expect(202);
    const known = await api
      .post("/api/v1/auth/password/forgot")
      .send({ email })
      .expect(202);
    assert.deepEqual(unknown.body, known.body);
    // A second request inside the cooldown still looks identical.
    const again = await api
      .post("/api/v1/auth/password/forgot")
      .send({ email })
      .expect(202);
    assert.deepEqual(again.body, known.body);

    const code = await t.emailCode(email, "RESET_PASSWORD");
    const reset = (body: object) =>
      api.post("/api/v1/auth/password/reset").send(body);
    await reset({
      email,
      code: code === "000000" ? "111111" : "000000",
      newPassword: "brand new password",
    }).expect(400);
    await reset({
      email: "nobody@test.example",
      code,
      newPassword: "brand new password",
    }).expect(400);
    await reset({ email, code, newPassword: "brand new password" }).expect(204);
    await reset({ email, code, newPassword: "another password!" }).expect(400);

    await api
      .get("/api/v1/auth/me")
      .set("Authorization", oldSession)
      .expect(401);
    await api
      .post("/api/v1/auth/login")
      .send({ email, password: "member test password" })
      .expect(401);
    await t.login(email, "brand new password");
    const audit = await database.query(
      "SELECT 1 FROM audit_events WHERE action='PASSWORD_RESET_BY_EMAIL'",
    );
    assert.equal(audit.rowCount, 1);
  } finally {
    await t.close();
  }
});

test("BL-05: registration can be limited to university email domains", async () => {
  process.env.ALLOWED_EMAIL_DOMAINS = "bsu.edu.eg";
  const t = await createTestApp();
  try {
    const { facultyId, categoryId } = await catalog(t);
    const body = {
      password: "member test password",
      name: "X Y",
      facultyId,
      categoryId,
    };
    const refused = await t.api
      .post("/api/v1/auth/register")
      .send({ ...body, email: "someone@gmail.com" })
      .expect(400);
    assert.match(refused.body.message, /bsu\.edu\.eg/);
    await t.api
      .post("/api/v1/auth/register")
      .send({ ...body, email: "someone@bsu.edu.eg" })
      .expect(201);
  } finally {
    delete process.env.ALLOWED_EMAIL_DOMAINS;
    await t.close();
  }
});

test("BL-16: the outbox delivers, retries with backoff, gives up, and wipes codes", async () => {
  const mailer = new FakeMailer();
  const t = await createTestApp({ mailer });
  const { api, database } = t;
  try {
    const { facultyId, categoryId } = await catalog(t);
    const dispatcher = t.app.get(NotificationDispatcher);
    const register = (email: string) =>
      api
        .post("/api/v1/auth/register")
        .send({
          email,
          password: "member test password",
          name: "Mail Test",
          facultyId,
          categoryId,
        })
        .expect(201);

    // Delivered once, with the code, then the stored code is erased.
    await register("a@test.example");
    const code = await t.emailCode("a@test.example");
    assert.equal(await dispatcher.runOnce(), 1);
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0]!.to, "a@test.example");
    assert.match(mailer.sent[0]!.email.subject, new RegExp(code));
    assert.match(mailer.sent[0]!.email.html, /dir="rtl"/);
    const sent = (
      await database.query(
        "SELECT status, payload FROM notifications WHERE to_email='a@test.example'",
      )
    ).rows[0];
    assert.equal(sent.status, "SENT");
    assert.deepEqual(sent.payload, {});
    assert.equal(await dispatcher.runOnce(), 0, "never sent twice");

    // A failing server: the row is rescheduled, the business change stands.
    mailer.failWith = Object.assign(new Error("connection refused"), {
      code: "ECONNREFUSED",
    });
    await register("b@test.example");
    await dispatcher.runOnce();
    const retry = (
      await database.query(
        "SELECT status, attempts, last_error, next_attempt_at > now() AS later FROM notifications WHERE to_email='b@test.example'",
      )
    ).rows[0];
    assert.deepEqual(
      [retry.status, retry.attempts, retry.last_error, retry.later],
      ["PENDING", 1, "ECONNREFUSED", true],
    );
    assert.equal(await dispatcher.runOnce(), 0, "not due yet");
    const user = await database.query(
      "SELECT 1 FROM users WHERE email='b@test.example'",
    );
    assert.equal(user.rowCount, 1);

    // After the last retry it gives up, and the code is erased anyway.
    await database.query(
      "UPDATE notifications SET attempts=5, next_attempt_at=now() WHERE to_email='b@test.example'",
    );
    await dispatcher.runOnce();
    const failed = (
      await database.query(
        "SELECT status, payload FROM notifications WHERE to_email='b@test.example'",
      )
    ).rows[0];
    assert.equal(failed.status, "FAILED");
    assert.deepEqual(failed.payload, {});

    // A claim abandoned by a crashed worker is picked up again.
    mailer.failWith = undefined;
    await register("c@test.example");
    await database.query(
      "UPDATE notifications SET status='SENDING', claimed_at=now() - interval '10 minutes' WHERE to_email='c@test.example'",
    );
    await dispatcher.runOnce();
    assert.ok(mailer.sent.some((m) => m.to === "c@test.example"));
  } finally {
    await t.close();
  }
});
