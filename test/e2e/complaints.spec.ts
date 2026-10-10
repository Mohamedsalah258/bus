import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../support/test-app.js";
import { operatingScenario } from "../support/scenario.js";

test("BL-18: complaint lifecycle — private to author and staff, internal notes, emails, audit", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const { api, database } = t;
    const get = (path: string, token: string) =>
      api.get(`/api/v1${path}`).set(s.as(token));
    const patch = (path: string, body: object, token: string) =>
      api.patch(`/api/v1${path}`).set(s.as(token)).send(body);

    const author = await s.member("author@test.example");
    const stranger = await s.member("stranger@test.example");
    const trip = await s.trip();
    await s.book(trip.id, author.token).expect(201);

    // Support staff (the SUPPORT role now has a job).
    const supportAccount = {
      email: "support@test.example",
      name: "Support Agent",
      role: "SUPPORT",
      temporaryPassword: "temporary password 9",
    };
    await s.post("/users", supportAccount).expect(201);
    let support = await t.bearer(
      supportAccount.email,
      supportAccount.temporaryPassword,
    );
    await t.verifyEmail(support, supportAccount.email);
    support =
      "Bearer " +
      (
        await s
          .post(
            "/auth/password",
            {
              currentPassword: supportAccount.temporaryPassword,
              newPassword: "support password!!",
            },
            support,
          )
          .expect(200)
      ).body.accessToken;

    // File: linked to a trip the author booked; a stranger's trip is refused.
    const strangerTrip = await s.trip({ dayOffset: 3 });
    await s
      .post(
        "/complaints",
        {
          kind: "COMPLAINT",
          subject: "Late bus",
          body: "Not my trip",
          tripId: strangerTrip.id,
        },
        author.token,
      )
      .expect(400);
    const filed = (
      await s
        .post(
          "/complaints",
          {
            kind: "COMPLAINT",
            subject: "تأخر الأتوبيس",
            body: "الأتوبيس تأخر ٤٠ دقيقة عن الموعد.",
            tripId: trip.id,
          },
          author.token,
        )
        .expect(201)
    ).body;
    assert.match(filed.reference, /^C-\d{4}-\d{6}$/);
    assert.equal(filed.status, "OPEN");
    const received = await database.query(
      "SELECT payload FROM notifications WHERE template='COMPLAINT_UPDATED' AND to_email='author@test.example'",
    );
    assert.equal(received.rows[0].payload.event, "RECEIVED");
    assert.equal(received.rows[0].payload.reference, filed.reference);

    // Nobody else can read it, by id or otherwise; staff without the permission neither.
    await get(`/complaints/${filed.id}`, stranger.token).expect(404);
    await api
      .post(`/api/v1/complaints/${filed.id}/messages`)
      .set(s.as(stranger.token))
      .send({ body: "hi" })
      .expect(404);
    await get("/complaints", author.token).expect(403);
    const strangerList = (
      await get("/complaints/mine", stranger.token).expect(200)
    ).body;
    assert.equal(strangerList.total, 0);

    // Staff queue, internal note, then a public reply (auto-assigns).
    const queue = (await get("/complaints?status=OPEN", support).expect(200))
      .body;
    assert.equal(queue.items[0].authorEmail, "author@test.example");
    await s
      .post(
        `/complaints/${filed.id}/messages`,
        { body: "Driver reported traffic on the ring road.", internal: true },
        support,
      )
      .expect(201);
    const replied = (
      await s
        .post(
          `/complaints/${filed.id}/messages`,
          { body: "نعتذر، جارٍ مراجعة الأمر مع السائق." },
          support,
        )
        .expect(201)
    ).body;
    assert.equal(replied.status, "IN_PROGRESS");
    assert.ok(replied.assignedTo);

    // The author never sees the internal note and cannot write one.
    const asAuthor = (
      await get(`/complaints/${filed.id}`, author.token).expect(200)
    ).body;
    assert.equal(asAuthor.messages.length, 2);
    assert.ok(asAuthor.messages.every((m: any) => !m.internal));
    assert.equal(asAuthor.messages[1].authorName, "Support Agent");
    await s
      .post(
        `/complaints/${filed.id}/messages`,
        { body: "x", internal: true },
        author.token,
      )
      .expect(400);
    const asStaff = (await get(`/complaints/${filed.id}`, support).expect(200))
      .body;
    assert.equal(asStaff.messages.length, 3);

    // Resolve → email with the answer; the author replies → reopened; close.
    const resolved = (
      await patch(
        `/complaints/${filed.id}/resolve`,
        { message: "تم توجيه السائق بالالتزام بالموعد." },
        support,
      ).expect(200)
    ).body;
    assert.equal(resolved.status, "RESOLVED");
    await patch(
      `/complaints/${filed.id}/resolve`,
      { message: "again" },
      support,
    ).expect(409);
    const reopened = (
      await s
        .post(
          `/complaints/${filed.id}/messages`,
          { body: "تكرر التأخير اليوم أيضًا." },
          author.token,
        )
        .expect(201)
    ).body;
    assert.equal(reopened.status, "IN_PROGRESS");
    const closed = (
      await patch(`/complaints/${filed.id}/close`, {}, author.token).expect(200)
    ).body;
    assert.equal(closed.status, "CLOSED");
    await s
      .post(`/complaints/${filed.id}/messages`, { body: "late" }, author.token)
      .expect(409);

    const events = (
      await database.query(
        "SELECT payload->>'event' AS e FROM notifications WHERE template='COMPLAINT_UPDATED' ORDER BY created_at",
      )
    ).rows.map((r: any) => r.e);
    assert.deepEqual(events, ["RECEIVED", "REPLIED", "RESOLVED"]);

    // Assignment only to staff who handle complaints.
    const second = (
      await s
        .post(
          "/complaints",
          {
            kind: "SUGGESTION",
            subject: "مقترح محطة",
            body: "نقترح إضافة محطة عند ميدان الجيزة.",
          },
          author.token,
        )
        .expect(201)
    ).body;
    const supportId = (await get("/auth/me", support).expect(200)).body.id;
    const memberId = (await get("/auth/me", stranger.token).expect(200)).body
      .id;
    await patch(
      `/complaints/${second.id}/assign`,
      { assigneeId: memberId },
      support,
    ).expect(400);
    const assigned = (
      await patch(
        `/complaints/${second.id}/assign`,
        { assigneeId: supportId },
        support,
      ).expect(200)
    ).body;
    assert.deepEqual(
      [assigned.status, assigned.assignedTo],
      ["IN_PROGRESS", supportId],
    );
    const suggestions = (
      await get("/complaints?kind=SUGGESTION", s.admin).expect(200)
    ).body;
    assert.equal(suggestions.total, 1);

    const audit = await database.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action IN ('COMPLAINT_FILED','COMPLAINT_STATUS_CHANGED')",
    );
    assert.ok(audit.rows[0].n >= 7);

    // Daily cap against abuse.
    await database.query(
      "UPDATE complaints SET created_at = now() WHERE user_id = (SELECT id FROM users WHERE email='stranger@test.example')",
    );
    for (let i = 0; i < 10; i++)
      await s
        .post(
          "/complaints",
          { kind: "SUGGESTION", subject: `Idea ${i}`, body: "Some idea here" },
          stranger.token,
        )
        .expect(201);
    await s
      .post(
        "/complaints",
        { kind: "SUGGESTION", subject: "Too many", body: "Some idea here" },
        stranger.token,
      )
      .expect(429);
  } finally {
    await t.close();
  }
});
