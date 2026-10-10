import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN, createTestApp, FakeMailer, totp } from "../support/test-app.js";
import { operatingScenario } from "../support/scenario.js";
import { NotificationDispatcher } from "../../src/modules/notifications/notification.dispatcher.js";

test("BL-10/21/33/34/35: edit catalog, filter audit, change email, failed emails, renew recovery codes", async () => {
  const mailer = new FakeMailer();
  const t = await createTestApp({ mailer });
  try {
    const s = await operatingScenario(t);
    const { api, database } = t;
    const patch = (path: string, body: object, token = s.admin) =>
      api.patch(`/api/v1${path}`).set(s.as(token)).send(body);
    const get = (path: string, token = s.admin) =>
      api.get(`/api/v1${path}`).set(s.as(token));

    // ---- BL-10: seasons keep their plans inside; categories rename/deactivate; faculties rename.
    await patch(`/seasons/${s.season.id}`, {
      endsOn: "2050-12-31",
      reason: "Shorten",
    }).expect(409); // plan runs to 2099
    const renamed = (
      await patch(`/seasons/${s.season.id}`, {
        name: "العام 2026/2027",
        reason: "Rename",
      }).expect(200)
    ).body;
    assert.equal(renamed.name, "العام 2026/2027");
    const cat = (
      await patch(`/categories/${s.category.id}`, {
        name: "موظف إداري",
        active: false,
        reason: "Merged",
      }).expect(200)
    ).body;
    assert.deepEqual([cat.name, cat.active], ["موظف إداري", false]);
    const publicCats = (await api.get("/api/v1/categories").expect(200)).body;
    assert.equal(publicCats.total, 0);
    await patch(`/categories/${s.category.id}`, {
      active: true,
      reason: "Restored",
    }).expect(200);
    const fac = (
      await patch(`/faculties/${s.faculty.id}`, {
        name: "كلية العلوم",
        reason: "Arabic name",
      }).expect(200)
    ).body;
    assert.equal(fac.name, "كلية العلوم");

    // ---- BL-33: admin edits a user's data; the user changes their email with a code.
    const member = await s.member("old@test.example");
    const memberId = (await get("/auth/me", member.token).expect(200)).body.id;
    const edited = (
      await patch(`/users/${memberId}/profile`, {
        jobTitle: "مدرس مساعد",
        reason: "Per HR letter",
      }).expect(200)
    ).body;
    assert.equal(edited.jobTitle, "مدرس مساعد");
    await s
      .post("/auth/email/change", { newEmail: ADMIN.email }, member.token)
      .expect(409);
    await s
      .post(
        "/auth/email/change",
        { newEmail: "new@test.example" },
        member.token,
      )
      .expect(204);
    const code = (
      await database.query(
        "SELECT payload->>'code' AS c FROM notifications WHERE to_email='new@test.example' AND template='VERIFY_EMAIL' ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0].c;
    await s
      .post(
        "/auth/email/change/confirm",
        { code: code === "000000" ? "111111" : "000000" },
        member.token,
      )
      .expect(400);
    await s
      .post("/auth/email/change/confirm", { code }, member.token)
      .expect(204);
    const me = (await get("/auth/me", member.token).expect(200)).body;
    assert.equal(me.email, "new@test.example");
    const notice = await database.query(
      "SELECT payload FROM notifications WHERE template='EMAIL_CHANGED' AND to_email='old@test.example'",
    );
    assert.equal(notice.rows[0].payload.newEmailMasked, "n***@test.example");

    // ---- BL-21: audit log filters.
    const byAction = (
      await get("/audit-events?action=EMAIL_CHANGED").expect(200)
    ).body;
    assert.deepEqual(
      [byAction.total, byAction.items[0].entityId],
      [1, memberId],
    );
    const byEntity = (
      await get(`/audit-events?entityId=${memberId}`).expect(200)
    ).body;
    assert.ok(
      byEntity.items.some(
        (e: any) => e.action === "USER_PROFILE_EDITED_BY_ADMIN",
      ),
    );
    const today = (
      await database.query(
        "SELECT ((now() AT TIME ZONE 'Africa/Cairo')::date)::text AS d",
      )
    ).rows[0].d;
    const dated = (
      await get(
        `/audit-events?from=${today}&to=${today}&action=CATEGORY_UPDATED`,
      ).expect(200)
    ).body;
    assert.equal(dated.total, 2);
    await get("/audit-events?action=bad action").expect(400);

    // ---- BL-34: failed emails are listed (no content) and can be retried, except codes.
    const dispatcher = t.app.get(NotificationDispatcher);
    await database.query("UPDATE notifications SET status='SENT'");
    await s
      .post("/news", { kind: "NEWS", title: "Filler", body: "Make no email" })
      .expect(201);
    mailer.failWith = Object.assign(new Error("down"), {
      code: "ECONNREFUSED",
    });
    await s
      .post(
        "/complaints",
        { kind: "COMPLAINT", subject: "Late bus", body: "Bus was late" },
        member.token,
      )
      .expect(201);
    await database.query(
      "UPDATE email_otps SET created_at = created_at - interval '2 minutes'",
    ); // cooldown passed
    await s
      .post(
        "/auth/email/change",
        { newEmail: "third@test.example" },
        member.token,
      )
      .expect(204);
    await database.query(
      "UPDATE notifications SET attempts=5, next_attempt_at=now() WHERE status='PENDING'",
    );
    await dispatcher.runOnce();
    const failed = (await get("/notifications?status=FAILED").expect(200)).body;
    assert.equal(failed.total, 2);
    assert.ok(
      failed.items.every(
        (n: any) => n.lastError === "ECONNREFUSED" && !("payload" in n),
      ),
    );
    const complaintMail = failed.items.find(
      (n: any) => n.template === "COMPLAINT_UPDATED",
    );
    const codeMail = failed.items.find(
      (n: any) => n.template === "VERIFY_EMAIL",
    );
    assert.deepEqual(
      [complaintMail.retryable, codeMail.retryable],
      [true, false],
    );
    await s.post(`/notifications/${codeMail.id}/retry`, {}).expect(409);
    mailer.failWith = undefined;
    await s.post(`/notifications/${complaintMail.id}/retry`, {}).expect(204);
    await dispatcher.runOnce();
    assert.ok(
      mailer.sent.some((m) => m.email.subject.includes("تم استلام رسالتك")),
    );
    await s.post(`/notifications/${complaintMail.id}/retry`, {}).expect(409);
    await get("/notifications", member.token).expect(403);

    // ---- BL-35: renew recovery codes with a current TOTP code.
    const adminSecret = (
      await database.query(
        "SELECT 1 FROM users WHERE email=$1 AND mfa_enabled",
        [ADMIN.email],
      )
    ).rowCount;
    assert.equal(adminSecret, 1);
    // Enrol a dispatcher to own a known secret.
    await s
      .post("/users", {
        email: "disp@test.example",
        name: "Dispatcher",
        role: "DISPATCHER",
        temporaryPassword: "temporary password 7",
      })
      .expect(201);
    let disp = await t.bearer("disp@test.example", "temporary password 7");
    await t.verifyEmail(disp, "disp@test.example");
    disp =
      "Bearer " +
      (
        await s
          .post(
            "/auth/password",
            {
              currentPassword: "temporary password 7",
              newPassword: "dispatcher password",
            },
            disp,
          )
          .expect(200)
      ).body.accessToken;
    const { secret, recoveryCodes } = await t.enrollMfa(disp);
    disp = await t.mfaBearer(
      "disp@test.example",
      "dispatcher password",
      secret,
    );
    await database.query(
      "UPDATE users SET mfa_last_step=NULL WHERE email='disp@test.example'",
    );
    await s
      .post("/auth/mfa/recovery-codes", { code: totp(secret, 5) }, disp)
      .expect(401);
    const renewed = (
      await s
        .post("/auth/mfa/recovery-codes", { code: totp(secret) }, disp)
        .expect(200)
    ).body;
    assert.equal(renewed.recoveryCodes.length, 10);
    assert.ok(
      renewed.recoveryCodes.every((c: string) => !recoveryCodes.includes(c)),
    );
    const challenge = await t.login("disp@test.example", "dispatcher password");
    await s
      .post(
        "/auth/mfa/verify",
        { mfaToken: challenge.mfaToken, recoveryCode: recoveryCodes[0] },
        "",
      )
      .expect(401);
    await s
      .post(
        "/auth/mfa/verify",
        {
          mfaToken: challenge.mfaToken,
          recoveryCode: renewed.recoveryCodes[0],
        },
        "",
      )
      .expect(200);
  } finally {
    await t.close();
  }
});
