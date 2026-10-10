import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestApp } from "../support/test-app.js";
import { operatingScenario } from "../support/scenario.js";

test("BL-15 / D7: group trip requests approved by the transport office hold buses and drivers", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const { api, database } = t;
    const patch = (path: string, body: object, token = s.admin) =>
      api.patch(`/api/v1${path}`).set(s.as(token)).send(body);
    const requester = await t.registerMember({
      email: "union@test.example",
      facultyId: s.faculty.id,
      categoryId: s.category.id,
    });
    const stranger = await t.registerMember({
      email: "stranger@test.example",
      facultyId: s.faculty.id,
      categoryId: s.category.id,
    });

    const day = Date.now() + 5 * 86_400_000;
    const at = (h: number) => new Date(day + h * 3_600_000).toISOString();
    const form = {
      name: "أحمد محمد علي حسن",
      phone: "01012345678",
      facultyId: s.faculty.id,
      organization: "اتحاد طلاب كلية العلوم",
      purpose: "رحلة علمية",
      destination: "متحف الحضارة - القاهرة",
      details: "زيارة علمية لطلاب الفرقة الثالثة",
      pickupLocation: "البوابة الرئيسية",
      passengers: 60,
      departureAt: at(0),
      returnAt: at(10),
    };
    await s
      .post(
        "/group-trips",
        {
          ...form,
          departureAt: new Date(Date.now() - 3_600_000).toISOString(),
        },
        requester,
      )
      .expect(400);
    await s
      .post("/group-trips", { ...form, returnAt: at(-1) }, requester)
      .expect(400);
    await s
      .post(
        "/group-trips",
        { ...form, nationalId: "29001011234567" },
        requester,
      )
      .expect(400);
    const request = (await s.post("/group-trips", form, requester).expect(201))
      .body;
    assert.match(request.reference, /^G-\d{4}-\d{6}$/);
    assert.deepEqual(
      [request.status, request.requesterName, request.trips.length],
      ["PENDING", form.name, 0],
    );

    // Private to the requester and the office.
    await api
      .get(`/api/v1/group-trips/${request.id}`)
      .set(s.as(stranger))
      .expect(404);
    await api.get("/api/v1/group-trips").set(s.as(stranger)).expect(403);
    await patch(
      `/group-trips/${request.id}/approve`,
      { assignments: [], reason: "x" },
      stranger,
    ).expect(403);

    // "Needs info" is not a rejection: complete and resubmit.
    await patch(`/group-trips/${request.id}/needs-info`, {
      reason: "أرفق موافقة رعاية الشباب",
    }).expect(200);
    await patch(
      `/group-trips/${request.id}/resubmit`,
      { note: "تم الحصول على الموافقة" },
      requester,
    ).expect(200);

    // Buses: seats must cover the group, and a busy bus is refused.
    const busA = (
      await s.post("/vehicles", { plate: "GRP-A", capacity: 40 }).expect(201)
    ).body;
    const busB = (
      await s.post("/vehicles", { plate: "GRP-B", capacity: 40 }).expect(201)
    ).body;
    const d1 = (
      await s
        .post("/drivers", { name: "سائق أول", phone: "01111111111" })
        .expect(201)
    ).body;
    const d2 = (await s.post("/drivers", { name: "سائق ثان" }).expect(201))
      .body;
    await patch(`/group-trips/${request.id}/approve`, {
      assignments: [{ vehicleId: busA.id, driverId: d1.id }],
      reason: "ok bus",
    }).expect(400);
    await patch(`/group-trips/${request.id}/approve`, {
      assignments: [
        { vehicleId: busA.id, driverId: d1.id },
        { vehicleId: busA.id, driverId: d2.id },
      ],
      reason: "duplicate bus",
    }).expect(400);
    // Bus B already runs a scheduled trip in that window.
    const busy = await s
      .post("/trips", {
        routeId: s.route.id,
        vehicleId: busB.id,
        driverId: d2.id,
        direction: "OUTBOUND",
        departureAt: at(2),
        arrivalAt: at(3),
        bookingClosesAt: at(1),
        cancellationClosesAt: at(1),
        capacity: 10,
      })
      .expect(201);
    const both = {
      assignments: [
        { vehicleId: busA.id, driverId: d1.id },
        { vehicleId: busB.id, driverId: d2.id },
      ],
      reason: "Approved: two buses",
    };
    const conflict = await patch(
      `/group-trips/${request.id}/approve`,
      both,
    ).expect(409);
    assert.match(conflict.body.message, /GRP-B/);
    await s
      .post(`/trips/${busy.body.id}/cancel`, {
        reason: "Bus needed for the outing",
      })
      .expect(200);

    const approved = (
      await patch(`/group-trips/${request.id}/approve`, both).expect(200)
    ).body;
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.trips.length, 2);
    assert.ok(
      approved.trips.every(
        (tr: any) => tr.kind === "GROUP" && tr.routeId === null,
      ),
    );
    const mail = (
      await database.query(
        "SELECT payload FROM notifications WHERE template='GROUP_TRIP_UPDATED' ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0].payload;
    assert.equal(mail.event, "APPROVED");
    assert.deepEqual(
      mail.buses.map((b: any) => b.plate),
      ["GRP-A", "GRP-B"],
    );
    assert.equal(mail.buses[0].driverPhone, "01111111111");

    // Group trips are never listed publicly or bookable, and they hold the buses.
    const publicTrips = (
      await api.get("/api/v1/trips").set(s.as(stranger)).expect(200)
    ).body;
    assert.ok(publicTrips.items.every((tr: any) => tr.kind !== "GROUP"));
    await s
      .post(
        "/bookings",
        {
          tripId: approved.trips[0].id,
          boardingStopId: s.route.stops[0].id,
          idempotencyKey: randomUUID(),
        },
        stranger,
      )
      .expect(409);
    const clash = {
      routeId: s.route.id,
      vehicleId: busA.id,
      driverId: d1.id,
      direction: "OUTBOUND",
      departureAt: at(4),
      arrivalAt: at(5),
      bookingClosesAt: at(3),
      cancellationClosesAt: at(3),
      capacity: 10,
    };
    await s.post("/trips", clash).expect(409);

    // Cancelling the outing frees the buses and tells the requester.
    await patch(`/group-trips/${request.id}/approve`, both).expect(409);
    const cancelled = (
      await patch(`/group-trips/${request.id}/cancel`, {
        reason: "تأجيل النشاط",
      }).expect(200)
    ).body;
    assert.equal(cancelled.status, "CANCELLED");
    assert.ok(cancelled.trips.every((tr: any) => tr.status === "CANCELLED"));
    await s.post("/trips", clash).expect(201);

    // Withdraw and reject paths.
    const second = (
      await s
        .post("/group-trips", { ...form, passengers: 10 }, requester)
        .expect(201)
    ).body;
    await patch(`/group-trips/${second.id}/withdraw`, {}, stranger).expect(404);
    await patch(`/group-trips/${second.id}/withdraw`, {}, requester).expect(
      200,
    );
    const third = (
      await s
        .post("/group-trips", { ...form, passengers: 10 }, requester)
        .expect(201)
    ).body;
    const rejected = (
      await patch(`/group-trips/${third.id}/reject`, {
        reason: "لا تتوفر أتوبيسات في هذا الموعد",
      }).expect(200)
    ).body;
    assert.equal(rejected.status, "REJECTED");
    await patch(
      `/group-trips/${third.id}/resubmit`,
      { note: "again" },
      requester,
    ).expect(409);

    const events = (
      await database.query(
        "SELECT payload->>'event' AS e FROM notifications WHERE template='GROUP_TRIP_UPDATED' ORDER BY created_at",
      )
    ).rows.map((r: any) => r.e);
    assert.deepEqual(events, [
      "RECEIVED",
      "NEEDS_INFO",
      "APPROVED",
      "CANCELLED",
      "RECEIVED",
      "RECEIVED",
      "REJECTED",
    ]);
    const mine = (
      await api.get("/api/v1/group-trips/mine").set(s.as(requester)).expect(200)
    ).body;
    assert.equal(mine.total, 3);
    const queue = (
      await api
        .get("/api/v1/group-trips?status=CANCELLED")
        .set(s.as(s.admin))
        .expect(200)
    ).body;
    assert.equal(queue.total, 1);
  } finally {
    await t.close();
  }
});
