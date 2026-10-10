import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../support/test-app.js";
import { operatingScenario } from "../support/scenario.js";

test("BL-20: reports count only real seats, by Cairo day, and every CSV export is audited", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const { api, database } = t;
    const a = await s.member("a@test.example");
    const b = await s.member("b@test.example");
    const c = await s.member("c@test.example");
    const trip1 = await s.trip({ dayOffset: 2 });
    const trip2 = await s.trip({ dayOffset: 3 });
    const draft = await s.trip({ dayOffset: 2, publish: false });
    const cancelled = await s.trip({ dayOffset: 2 });

    await s.book(trip1.id, a.token).expect(201);
    await s.book(trip1.id, b.token).expect(201);
    const cBooking = (await s.book(trip1.id, c.token).expect(201)).body;
    await api
      .patch(`/api/v1/bookings/${cBooking.id}/cancel`)
      .set(s.as(c.token))
      .expect(200);
    await s.book(trip2.id, a.token).expect(201);
    const bOnTrip2 = (await s.book(trip2.id, b.token).expect(201)).body;
    await s
      .patch(`/bookings/${bOnTrip2.id}/admin-cancel`, { reason: "Seat needed" })
      .expect(200);
    await s
      .post(`/trips/${cancelled.id}/cancel`, { reason: "Not running" })
      .expect(200);
    void draft;

    const days = (
      await database.query(
        "SELECT (departure_at AT TIME ZONE 'Africa/Cairo')::date::text AS d FROM trips WHERE id = ANY($1) ORDER BY departure_at",
        [[trip1.id, trip2.id]],
      )
    ).rows.map((r: any) => r.d);
    const range = `from=${days[0]}&to=${days[1]}`;
    const get = (path: string, token = s.admin) =>
      api.get(`/api/v1/reports/${path}`).set(s.as(token));

    // Daily: drafts and cancelled trips never count as offered seats.
    const daily = (await get(`bookings-daily?${range}`).expect(200)).body;
    const first = daily.find((r: any) => r.date === days[0]);
    const second = daily.find((r: any) => r.date === days[1]);
    assert.deepEqual(
      [
        first.trips,
        first.seats,
        first.confirmed,
        first.cancelledByPassenger,
        first.cancelledByAdmin,
      ],
      [1, 10, 2, 1, 0],
    );
    assert.deepEqual(
      [second.trips, second.confirmed, second.cancelledByAdmin],
      [1, 1, 1],
    );

    // Occupancy: 3 confirmed of 20 seats = 15.0 %.
    const byRoute = (await get(`occupancy?${range}`).expect(200)).body;
    assert.deepEqual(
      [
        byRoute[0].routeName,
        byRoute[0].trips,
        byRoute[0].seats,
        byRoute[0].confirmed,
        byRoute[0].occupancyPercent,
      ],
      ["West route", 2, 20, 3, 15],
    );
    const byFaculty = (
      await get(`occupancy?${range}&groupBy=faculty`).expect(200)
    ).body;
    assert.deepEqual(
      [
        byFaculty[0].facultyName,
        byFaculty[0].confirmed,
        byFaculty[0].passengers,
      ],
      ["Science", 3, 2],
    );

    // Subscriptions: statuses, rejection reasons, decision time.
    const d = await t.registerMember({
      email: "d@test.example",
      facultyId: s.faculty.id,
      categoryId: s.category.id,
    });
    const rejected = (
      await s
        .post("/subscriptions", { planId: s.plan.id, routeId: s.route.id }, d)
        .expect(201)
    ).body;
    await s
      .patch(`/subscriptions/${rejected.id}/review`, {
        status: "REJECTED",
        reason: "ليس ضمن العاملين",
      })
      .expect(200);
    const today = (
      await database.query(
        "SELECT ((now() AT TIME ZONE 'Africa/Cairo')::date)::text AS d",
      )
    ).rows[0].d;
    const subs = (
      await get(`subscriptions?from=${today}&to=${today}`).expect(200)
    ).body;
    assert.deepEqual(
      Object.fromEntries(subs.byStatus.map((r: any) => [r.key, r.count])),
      { APPROVED: 3, REJECTED: 1 },
    );
    assert.deepEqual(subs.rejectionReasons, [
      { key: "ليس ضمن العاملين", count: 1 },
    ]);
    assert.equal(typeof subs.averageDecisionHours, "number");

    // Complaints summary.
    const complaint = (
      await s
        .post(
          "/complaints",
          { kind: "COMPLAINT", subject: "Late bus", body: "Bus was late" },
          a.token,
        )
        .expect(201)
    ).body;
    await s
      .patch(`/complaints/${complaint.id}/resolve`, { message: "Handled" })
      .expect(200);
    const comp = (await get(`complaints?from=${today}&to=${today}`).expect(200))
      .body;
    assert.deepEqual(comp.byStatus, [{ key: "RESOLVED", count: 1 }]);
    assert.equal(typeof comp.averageResolutionHours, "number");

    // CSV download for Excel, audited.
    const csv = await get(`occupancy?${range}&format=csv`).expect(200);
    assert.match(csv.headers["content-type"], /text\/csv/);
    assert.match(csv.headers["content-disposition"], /occupancy-route_/);
    assert.ok(csv.text.startsWith('\uFEFF"الخط"'));
    const exports = await database.query(
      "SELECT metadata FROM audit_events WHERE action='REPORT_EXPORTED'",
    );
    assert.deepEqual(
      [exports.rowCount, exports.rows[0].metadata.report],
      [1, "occupancy-route"],
    );

    // Guard rails.
    await get(`bookings-daily?from=2026-01-01&to=2027-06-01`).expect(400);
    await get(`bookings-daily?from=${days[1]}&to=${days[0]}`).expect(400);
    await get(`bookings-daily?${range}`, a.token).expect(403);
  } finally {
    await t.close();
  }
});

test("BL-19: public news feed with pinned alerts, scheduling, expiry and hiding", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const { api } = t;
    const member = await s.member("a@test.example");
    const post = (body: object, token = s.admin) =>
      api.post("/api/v1/news").set(s.as(token)).send(body);

    await post({
      kind: "NEWS",
      title: "Old news",
      body: "Something happened",
    }).expect(201);
    const alert = (
      await post({
        kind: "ALERT",
        title: "تأخير الخط الغربي",
        body: "تأخير ٣٠ دقيقة اليوم",
        routeId: s.route.id,
        pinned: true,
      }).expect(201)
    ).body;
    await post({
      kind: "NEWS",
      title: "Scheduled",
      body: "Not yet",
      publishedAt: new Date(Date.now() + 86_400_000).toISOString(),
    }).expect(201);
    const expiring = (
      await post({
        kind: "NEWS",
        title: "Expiring",
        body: "Soon gone",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }).expect(201)
    ).body;
    await post({
      kind: "NEWS",
      title: "Bad",
      body: "Bad window",
      publishedAt: "2030-01-02T00:00:00Z",
      expiresAt: "2030-01-01T00:00:00Z",
    }).expect(400);
    await post(
      { kind: "NEWS", title: "Member", body: "Not allowed" },
      member.token,
    ).expect(403);

    // Public, no sign-in: pinned alert first, scheduled post hidden.
    const feed = (await api.get("/api/v1/news").expect(200)).body;
    assert.equal(feed.items[0].title, "تأخير الخط الغربي");
    assert.ok(feed.items.every((n: any) => n.title !== "Scheduled"));
    assert.equal(feed.total, 3);
    await api.get(`/api/v1/news/${alert.id}`).expect(200);
    await api.get("/api/v1/news?includeHidden=true").expect(403);

    // Expiry and hiding.
    await t.database.query(
      "UPDATE news_posts SET expires_at = now() - interval '1 second', published_at = now() - interval '1 hour' WHERE id=$1",
      [expiring.id],
    );
    await api
      .patch(`/api/v1/news/${alert.id}`)
      .set(s.as(s.admin))
      .send({ active: false })
      .expect(200);
    const after = (await api.get("/api/v1/news").expect(200)).body;
    assert.deepEqual(
      after.items.map((n: any) => n.title),
      ["Old news"],
    );
    await api.get(`/api/v1/news/${alert.id}`).expect(404);
    const managed = (
      await api.get("/api/v1/news/manage").set(s.as(s.admin)).expect(200)
    ).body;
    assert.equal(managed.total, 4);
    const alerts = (
      await api
        .get(`/api/v1/news/manage?kind=ALERT&routeId=${s.route.id}`)
        .set(s.as(s.admin))
        .expect(200)
    ).body;
    assert.equal(alerts.total, 1);
  } finally {
    await t.close();
  }
});
