import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestApp } from "../support/test-app.js";

test("BL-08: plans, NEEDS_INFO round trip, payment gate, suspension, withdrawal, reapplication", async () => {
  const t = await createTestApp();
  const { api, database } = t;
  try {
    const admin = await t.adminBearer();
    const as = (token: string) => ({ Authorization: token });
    const post = (path: string, body: object, token = admin) =>
      api.post(`/api/v1${path}`).set(as(token)).send(body);
    const patch = (path: string, body: object, token = admin) =>
      api.patch(`/api/v1${path}`).set(as(token)).send(body);

    const faculty = (await post("/faculties", { name: "Science" }).expect(201))
      .body;
    const category = await t.createCategory("EMPLOYEE", "موظف");
    const route = (
      await post("/routes", {
        name: "West route",
        stops: [{ name: "Cairo" }, { name: "Campus" }],
        eligibleCategoryIds: [category.id],
      }).expect(201)
    ).body;
    const season = (
      await post("/seasons", {
        name: "2000-2099",
        startsOn: "2000-01-01",
        endsOn: "2099-12-31",
      }).expect(201)
    ).body;

    // D2: annual or term, free or paid, side by side in one season.
    const annualFree = await t.createPlan(season.id, {
      name: "سنوي مجاني",
      feeMinor: 0,
    });
    const termPaid = await t.createPlan(season.id, {
      name: "فصلي مدفوع",
      period: "TERM",
      feeMinor: 150000,
    });
    await post("/plans", {
      seasonId: season.id,
      name: "Outside season",
      period: "TERM",
      startsOn: "1999-01-01",
      endsOn: "1999-06-30",
      feeMinor: 0,
    }).expect(400);

    const member = await t.registerMember({
      email: "member@test.example",
      facultyId: faculty.id,
      categoryId: category.id,
    });
    const plans = (
      await api
        .get(`/api/v1/plans?seasonId=${season.id}`)
        .set(as(member))
        .expect(200)
    ).body;
    assert.equal(plans.total, 2);

    const sub = (
      await post(
        "/subscriptions",
        { planId: termPaid.id, routeId: route.id },
        member,
      ).expect(201)
    ).body;
    assert.deepEqual(
      [
        sub.status,
        sub.paymentStatus,
        sub.feeMinor,
        sub.paidMinor,
        sub.planName,
      ],
      ["PENDING", "UNPAID", 150000, 0, "فصلي مدفوع"],
    );
    // The free annual plan covers the same dates on the same route.
    await post(
      "/subscriptions",
      { planId: annualFree.id, routeId: route.id },
      member,
    ).expect(409);

    // NEEDS_INFO → the applicant is emailed and resubmits.
    const needs = (
      await patch(`/subscriptions/${sub.id}/review`, {
        status: "NEEDS_INFO",
        reason: "Attach staff ID",
      }).expect(200)
    ).body;
    assert.equal(needs.status, "NEEDS_INFO");
    const mail = await database.query(
      "SELECT payload FROM notifications WHERE template='SUBSCRIPTION_STATUS_CHANGED' ORDER BY created_at DESC LIMIT 1",
    );
    assert.equal(mail.rows[0].payload.status, "NEEDS_INFO");
    await patch(`/subscriptions/${sub.id}/review`, {
      status: "APPROVED",
      reason: "too early",
    }).expect(409);
    const back = (
      await patch(
        `/subscriptions/${sub.id}/resubmit`,
        { note: "Staff ID attached" },
        member,
      ).expect(200)
    ).body;
    assert.deepEqual(
      [back.status, back.applicantNote],
      ["PENDING", "Staff ID attached"],
    );
    await patch(
      `/subscriptions/${sub.id}/resubmit`,
      { note: "again" },
      member,
    ).expect(409);
    await patch(`/subscriptions/${sub.id}/review`, {
      status: "APPROVED",
      reason: "Verified",
    }).expect(200);

    // A trip covered by the plan.
    const vehicle = (
      await post("/vehicles", { plate: "BUS-1", capacity: 10 }).expect(201)
    ).body;
    const driver = (await post("/drivers", { name: "Driver One" }).expect(201))
      .body;
    const base = Date.now() + 86_400_000;
    const iso = (ms: number) => new Date(base + ms).toISOString();
    const trip = (
      await post("/trips", {
        routeId: route.id,
        vehicleId: vehicle.id,
        driverId: driver.id,
        direction: "OUTBOUND",
        departureAt: iso(0),
        arrivalAt: iso(3_600_000),
        bookingClosesAt: iso(-3_600_000),
        cancellationClosesAt: iso(-3_600_000),
        capacity: 10,
      }).expect(201)
    ).body;
    const book = () =>
      post(
        "/bookings",
        {
          tripId: trip.id,
          boardingStopId: route.stops[0].id,
          idempotencyKey: randomUUID(),
        },
        member,
      );

    // Approved but unpaid: no booking yet.
    await book().expect(403);

    // Manual payments: partial, then the rest. Overpaying and future dates are refused.
    const pay = (amountMinor: number, paidOn = "2026-10-01") =>
      post(`/subscriptions/${sub.id}/payments`, {
        amountMinor,
        method: "CASH",
        reference: "R-1",
        paidOn,
      });
    await pay(200000).expect(400);
    await pay(1000, "2999-01-01").expect(400);
    const partial = (await pay(100000).expect(201)).body;
    assert.deepEqual(
      [partial.paymentStatus, partial.paidMinor],
      ["UNPAID", 100000],
    );
    await book().expect(403);
    const paid = (await pay(50000).expect(201)).body;
    assert.deepEqual(
      [paid.paymentStatus, paid.paidMinor, paid.payments.length],
      ["PAID", 150000, 2],
    );
    await pay(1).expect(409);
    const booked = (await book().expect(201)).body;

    // Members cannot record payments; the owner can read the detail.
    await post(
      `/subscriptions/${sub.id}/payments`,
      { amountMinor: 1, method: "CASH", paidOn: "2026-10-01" },
      member,
    ).expect(403);
    const detail = (
      await api
        .get(`/api/v1/subscriptions/${sub.id}`)
        .set(as(member))
        .expect(200)
    ).body;
    assert.equal(detail.payments.length, 2);

    // Suspension blocks new bookings until reinstated.
    await api
      .patch(`/api/v1/bookings/${booked.id}/cancel`)
      .set(as(member))
      .expect(200);
    await patch(`/subscriptions/${sub.id}/suspend`, {
      reason: "Card misuse reported",
    }).expect(200);
    await book().expect(403);
    await patch(`/subscriptions/${sub.id}/suspend`, { reason: "twice" }).expect(
      409,
    );
    await patch(`/subscriptions/${sub.id}/reinstate`, {
      reason: "Resolved",
    }).expect(200);
    await book().expect(201);
    const reinstated = await database.query(
      "SELECT payload FROM notifications WHERE template='SUBSCRIPTION_STATUS_CHANGED' ORDER BY created_at DESC LIMIT 1",
    );
    assert.equal(reinstated.rows[0].payload.status, "REINSTATED");

    // Another member: withdraw, reapply; reject, reapply.
    const other = await t.registerMember({
      email: "other@test.example",
      facultyId: faculty.id,
      categoryId: category.id,
    });
    const first = (
      await post(
        "/subscriptions",
        { planId: annualFree.id, routeId: route.id },
        other,
      ).expect(201)
    ).body;
    assert.equal(first.paymentStatus, "NOT_REQUIRED");
    // Not theirs: invisible and untouchable.
    await api
      .get(`/api/v1/subscriptions/${first.id}`)
      .set(as(member))
      .expect(404);
    await patch(`/subscriptions/${first.id}/withdraw`, {}, member).expect(404);
    await post(
      "/subscriptions",
      { planId: annualFree.id, routeId: route.id },
      other,
    ).expect(409);
    await patch(`/subscriptions/${first.id}/withdraw`, {}, other).expect(200);
    const second = (
      await post(
        "/subscriptions",
        { planId: annualFree.id, routeId: route.id },
        other,
      ).expect(201)
    ).body;
    await patch(`/subscriptions/${second.id}/review`, {
      status: "REJECTED",
      reason: "Not on staff list",
    }).expect(200);
    await patch(`/subscriptions/${second.id}/withdraw`, {}, other).expect(409);
    await post(
      "/subscriptions",
      { planId: annualFree.id, routeId: route.id },
      other,
    ).expect(201);

    // Closing a plan stops new requests only.
    await patch(`/plans/${annualFree.id}/status`, {
      active: false,
      reason: "Season closed",
    }).expect(200);
    const third = await t.registerMember({
      email: "third@test.example",
      facultyId: faculty.id,
      categoryId: category.id,
    });
    await post(
      "/subscriptions",
      { planId: annualFree.id, routeId: route.id },
      third,
    ).expect(400);

    const actions = (
      await database.query("SELECT DISTINCT action FROM audit_events")
    ).rows.map((r: any) => r.action);
    for (const action of [
      "PLAN_CREATED",
      "PLAN_STATUS_CHANGED",
      "SUBSCRIPTION_RESUBMITTED",
      "SUBSCRIPTION_WITHDRAWN",
      "SUBSCRIPTION_SUSPENDED",
      "SUBSCRIPTION_REINSTATED",
      "SUBSCRIPTION_PAYMENT_RECORDED",
    ])
      assert.ok(actions.includes(action), action);
  } finally {
    await t.close();
  }
});
