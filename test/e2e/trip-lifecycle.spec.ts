import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../support/test-app.js";
import { operatingScenario } from "../support/scenario.js";

test("BL-12/13/17: draft → published → closed → reopened → cancelled, with passenger emails", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const a = await s.member("a@test.example");
    const b = await s.member("b@test.example");
    const c = await s.member("c@test.example");

    // Drafts are invisible and not bookable.
    const draft = await s.trip({ publish: false });
    assert.equal(draft.status, "DRAFT");
    const visible = async () =>
      (await t.api.get("/api/v1/trips").set(s.as(a.token)).expect(200)).body
        .total;
    assert.equal(await visible(), 0);
    await s.book(draft.id, a.token).expect(409);
    await s.post(`/trips/${draft.id}/publish`, {}).expect(200);
    await s.post(`/trips/${draft.id}/publish`, {}).expect(409);
    assert.equal(await visible(), 1);

    // Bookings email a confirmation, once (no email on an idempotent replay).
    const ba = (await s.book(draft.id, a.token).expect(201)).body;
    await s.book(draft.id, b.token).expect(201);
    assert.equal((await s.emails("BOOKING_CONFIRMED")).length, 2);
    const confirmation = (await s.emails("BOOKING_CONFIRMED"))[0]!;
    assert.equal(confirmation.payload.routeName, "West route");
    assert.equal(confirmation.payload.boardingStopName, "Cairo");

    // Closing stops new bookings; passengers may still cancel.
    await s.post(`/trips/${draft.id}/close`, {}).expect(200);
    await s.book(draft.id, c.token).expect(409);
    await t.api
      .patch(`/api/v1/bookings/${ba.id}/cancel`)
      .set(s.as(a.token))
      .expect(200);
    assert.equal((await s.emails("BOOKING_CANCELLED")).length, 1);
    await s.post(`/trips/${draft.id}/reopen`, {}).expect(200);
    const bc = (await s.book(draft.id, c.token).expect(201)).body;

    // Staff schedule shows every status and seats taken.
    const from = new Date(Date.now()).toISOString();
    const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const schedule = (
      await t.api
        .get(
          `/api/v1/trips/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        )
        .set(s.as(s.admin))
        .expect(200)
    ).body;
    assert.equal(schedule.items[0].confirmedBookings, 2);
    await t.api
      .get(`/api/v1/trips/schedule?from=${from}&to=${to}`)
      .set(s.as(a.token))
      .expect(403);

    // Staff cancel one booking, with a reason the passenger receives.
    const adminCancelled = (
      await s
        .patch(`/bookings/${bc.id}/admin-cancel`, {
          reason: "Seat reserved for a supervisor",
        })
        .expect(200)
    ).body;
    assert.deepEqual(
      [adminCancelled.status, adminCancelled.cancelReason],
      ["CANCELLED_BY_ADMIN", "Seat reserved for a supervisor"],
    );
    await s
      .patch(`/bookings/${bc.id}/admin-cancel`, { reason: "again" })
      .expect(409);
    // Passenger "cancel" afterwards is idempotent and changes nothing.
    const after = (
      await t.api
        .patch(`/api/v1/bookings/${bc.id}/cancel`)
        .set(s.as(c.token))
        .expect(200)
    ).body;
    assert.equal(after.status, "CANCELLED_BY_ADMIN");
    await s
      .patch(
        `/bookings/${bc.id}/admin-cancel`,
        { reason: "member cannot" },
        c.token,
      )
      .expect(403);

    // Cancelling the trip cancels the remaining booking and emails the reason.
    const cancelled = (
      await s
        .post(`/trips/${draft.id}/cancel`, { reason: "Bus breakdown" })
        .expect(200)
    ).body;
    assert.deepEqual(
      [cancelled.status, cancelled.cancelledBookings, cancelled.cancelReason],
      ["CANCELLED", 1, "Bus breakdown"],
    );
    const adminMails = await s.emails("BOOKING_CANCELLED_BY_ADMIN");
    assert.deepEqual(
      adminMails.map((m) => [m.to, m.payload.reason]),
      [
        ["c@test.example", "Seat reserved for a supervisor"],
        ["b@test.example", "Bus breakdown"],
      ],
    );
    const mine = (
      await t.api.get("/api/v1/bookings/mine").set(s.as(b.token)).expect(200)
    ).body;
    assert.equal(mine.items[0].status, "CANCELLED_BY_ADMIN");
    await s.post(`/trips/${draft.id}/cancel`, { reason: "twice" }).expect(409);
    await s.post(`/trips/${draft.id}/start`, {}).expect(409);
    assert.equal(await visible(), 0);

    // A cancelled trip frees its bus and driver for the same time.
    const freed = await s.post("/trips", {
      routeId: s.route.id,
      vehicleId: draft.vehicleId,
      driverId: draft.driverId,
      direction: "OUTBOUND",
      departureAt: draft.departureAt,
      arrivalAt: draft.arrivalAt,
      bookingClosesAt: new Date(
        Date.parse(draft.departureAt) - 3_600_000,
      ).toISOString(),
      cancellationClosesAt: new Date(
        Date.parse(draft.departureAt) - 3_600_000,
      ).toISOString(),
      capacity: 10,
    });
    assert.equal(freed.status, 201);
  } finally {
    await t.close();
  }
});

test("BL-12: in progress → completed; running trips cannot be cancelled", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const a = await s.member("a@test.example");
    const trip = await s.trip();
    const booking = (await s.book(trip.id, a.token).expect(201)).body;
    await s.post(`/trips/${trip.id}/complete`, {}).expect(409);
    const started = (await s.post(`/trips/${trip.id}/start`, {}).expect(200))
      .body;
    assert.equal(started.status, "IN_PROGRESS");
    assert.ok(started.startedAt);
    await s.book(trip.id, a.token).expect(409);
    await s
      .post(`/trips/${trip.id}/cancel`, { reason: "too late" })
      .expect(409);
    await s
      .patch(`/bookings/${booking.id}/admin-cancel`, { reason: "too late" })
      .expect(409);
    await t.api
      .patch(`/api/v1/bookings/${booking.id}/cancel`)
      .set(s.as(a.token))
      .expect(409);
    const done = (await s.post(`/trips/${trip.id}/complete`, {}).expect(200))
      .body;
    assert.equal(done.status, "COMPLETED");
    assert.ok(done.completedAt);
    await s.post(`/trips/${trip.id}/complete`, {}).expect(409);
    await s.post(`/trips/${trip.id}/start`, {}, a.token).expect(403);

    const actions = (
      await t.database.query("SELECT DISTINCT action FROM audit_events")
    ).rows.map((r: any) => r.action);
    for (const action of ["TRIP_STARTED", "TRIP_COMPLETED"])
      assert.ok(actions.includes(action), action);
  } finally {
    await t.close();
  }
});

test("BL-13: suspending a subscription cancels its upcoming bookings; reinstating does not restore them", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const a = await s.member("a@test.example");
    const soon = await s.trip({ dayOffset: 1 });
    const later = await s.trip({ dayOffset: 2 });
    const b1 = (await s.book(soon.id, a.token).expect(201)).body;
    const b2 = (await s.book(later.id, a.token).expect(201)).body;

    await s
      .patch(`/subscriptions/${a.subscriptionId}/suspend`, {
        reason: "Card misuse",
      })
      .expect(200);
    const mine = (
      await t.api.get("/api/v1/bookings/mine").set(s.as(a.token)).expect(200)
    ).body;
    for (const b of mine.items) {
      assert.equal(b.status, "CANCELLED_BY_ADMIN");
      assert.match(b.cancelReason, /إيقاف الاشتراك: Card misuse/);
    }
    assert.deepEqual(
      new Set(mine.items.map((b: any) => b.id)),
      new Set([b1.id, b2.id]),
    );
    assert.equal((await s.emails("BOOKING_CANCELLED_BY_ADMIN")).length, 2);
    const audit = await t.database.query(
      "SELECT metadata FROM audit_events WHERE action='SUBSCRIPTION_SUSPENDED'",
    );
    assert.equal(audit.rows[0].metadata.cancelledBookings, 2);

    await s
      .patch(`/subscriptions/${a.subscriptionId}/reinstate`, {
        reason: "Resolved",
      })
      .expect(200);
    const again = (
      await t.api.get("/api/v1/bookings/mine").set(s.as(a.token)).expect(200)
    ).body;
    assert.ok(again.items.every((b: any) => b.status === "CANCELLED_BY_ADMIN"));
    await s.book(soon.id, a.token).expect(201);
  } finally {
    await t.close();
  }
});
