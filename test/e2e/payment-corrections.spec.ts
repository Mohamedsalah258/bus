import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../support/test-app.js";
import { operatingScenario } from "../support/scenario.js";

test("BL-32: a mistaken payment is reversed, never edited; refunds only for closed requests", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const paidPlan = await t.createPlan(s.season.id, {
      name: "Paid term",
      period: "TERM",
      feeMinor: 100000,
    });
    const register = (email: string) =>
      t.registerMember({
        email,
        facultyId: s.faculty.id,
        categoryId: s.category.id,
      });
    const pay = (id: string, amountMinor: number) =>
      s.post(`/subscriptions/${id}/payments`, {
        amountMinor,
        method: "CASH",
        paidOn: "2026-10-01",
      });

    // Approved member: full payment entered against the wrong person → reverse it.
    const a = await register("a@test.example");
    const sub = (
      await s
        .post("/subscriptions", { planId: paidPlan.id, routeId: s.route.id }, a)
        .expect(201)
    ).body;
    await s
      .patch(`/subscriptions/${sub.id}/review`, {
        status: "APPROVED",
        reason: "Verified ok",
      })
      .expect(200);
    const paid = (await pay(sub.id, 100000).expect(201)).body;
    assert.equal(paid.paymentStatus, "PAID");
    const paymentId = paid.payments[0].id;

    const reversed = (
      await s
        .post(`/subscriptions/${sub.id}/payments/${paymentId}/reverse`, {
          reason: "Recorded on the wrong account",
        })
        .expect(200)
    ).body;
    assert.deepEqual(
      [reversed.paymentStatus, reversed.paidMinor],
      ["UNPAID", 0],
    );
    assert.deepEqual(
      reversed.payments.map((p: any) => [
        p.kind,
        p.amountMinor,
        p.reversesPaymentId,
      ]),
      [
        ["PAYMENT", 100000, null],
        ["REVERSAL", 100000, paymentId],
      ],
    );
    await s
      .post(`/subscriptions/${sub.id}/payments/${paymentId}/reverse`, {
        reason: "twice",
      })
      .expect(409);
    await s
      .post(
        `/subscriptions/${sub.id}/payments/${reversed.payments[1].id}/reverse`,
        { reason: "reverse a reversal" },
      )
      .expect(404);
    await s
      .post(
        `/subscriptions/${sub.id}/payments/${paymentId}/reverse`,
        { reason: "member" },
        a,
      )
      .expect(403);

    // Booking is gated again until the correct payment is recorded.
    const trip = await s.trip();
    await s.book(trip.id, a).expect(403);
    const fixed = (await pay(sub.id, 100000).expect(201)).body;
    assert.deepEqual([fixed.paymentStatus, fixed.paidMinor], ["PAID", 100000]);
    await s.book(trip.id, a).expect(201);
    // Refunds are not for live subscriptions.
    await s
      .post(`/subscriptions/${sub.id}/refunds`, {
        amountMinor: 1000,
        method: "CASH",
        paidOn: "2026-10-02",
        reason: "not allowed",
      })
      .expect(409);

    // Paid while pending, then rejected: the money goes back.
    const b = await register("b@test.example");
    const other = (
      await s
        .post("/subscriptions", { planId: paidPlan.id, routeId: s.route.id }, b)
        .expect(201)
    ).body;
    await pay(other.id, 60000).expect(201);
    await s
      .patch(`/subscriptions/${other.id}/review`, {
        status: "REJECTED",
        reason: "Not eligible",
      })
      .expect(200);
    const refund = (amountMinor: number) =>
      s.post(`/subscriptions/${other.id}/refunds`, {
        amountMinor,
        method: "BANK_TRANSFER",
        reference: "TRX-9",
        paidOn: "2026-10-05",
        reason: "Request rejected",
      });
    await refund(60001).expect(400);
    const refunded = (await refund(60000).expect(201)).body;
    assert.equal(refunded.paidMinor, 0);
    assert.equal(refunded.payments.at(-1).kind, "REFUND");
    await refund(1).expect(400);
    assert.equal((await s.emails("SUBSCRIPTION_REFUND_RECORDED")).length, 1);

    const actions = (
      await t.database.query("SELECT DISTINCT action FROM audit_events")
    ).rows.map((r: any) => r.action);
    for (const action of [
      "SUBSCRIPTION_PAYMENT_REVERSED",
      "SUBSCRIPTION_REFUND_RECORDED",
    ])
      assert.ok(actions.includes(action), action);
    // Nothing was ever updated or deleted in the ledger.
    const rows = await t.database.query(
      "SELECT count(*)::int AS n FROM subscription_payments",
    );
    assert.equal(rows.rows[0].n, 5);
  } finally {
    await t.close();
  }
});
