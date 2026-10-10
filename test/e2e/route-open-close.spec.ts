import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { renderTemplate } from "../../src/modules/notifications/notification-template.js";
import { createTestApp } from "../support/test-app.js";
import { operatingScenario } from "../support/scenario.js";

test("routes: admin closes and reopens any route; return trips list stops in reverse", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const { api } = t;
    const patchRoute = (body: object, token = s.admin) =>
      api.patch(`/api/v1/routes/${s.route.id}`).set(s.as(token)).send(body);
    const member = await s.member("a@test.example");
    const trip = await s.trip();
    const booked = (await s.book(trip.id, member.token).expect(201)).body;

    // Return trips show the same stops reversed.
    const vehicle = (
      await s.post("/vehicles", { plate: "RET-1", capacity: 20 }).expect(201)
    ).body;
    const driver = (
      await s.post("/drivers", { name: "Return Driver" }).expect(201)
    ).body;
    const base = Date.now() + 2 * 86_400_000;
    const iso = (ms: number) => new Date(base + ms).toISOString();
    await s
      .post("/trips", {
        routeId: s.route.id,
        vehicleId: vehicle.id,
        driverId: driver.id,
        direction: "RETURN",
        departureAt: iso(0),
        arrivalAt: iso(3_600_000),
        bookingClosesAt: iso(-3_600_000),
        cancellationClosesAt: iso(-3_600_000),
        capacity: 20,
      })
      .expect(201);
    const list = (
      await api.get("/api/v1/trips").set(s.as(member.token)).expect(200)
    ).body;
    const out = list.items.find((x: any) => x.direction === "OUTBOUND");
    const ret = list.items.find((x: any) => x.direction === "RETURN");
    assert.deepEqual(
      out.stops.map((x: any) => x.name),
      ["Cairo", "Campus"],
    );
    assert.deepEqual(
      ret.stops.map((x: any) => x.name),
      ["Campus", "Cairo"],
    );

    // Close the route: it disappears for members and blocks new activity.
    const closed = (
      await patchRoute({
        active: false,
        reason: "Route suspended this term",
      }).expect(200)
    ).body;
    assert.deepEqual([closed.active, closed.upcomingTrips], [false, 2]);
    const visible = (
      await api.get("/api/v1/routes").set(s.as(member.token)).expect(200)
    ).body;
    assert.equal(visible.total, 0);
    await api
      .get("/api/v1/routes?includeInactive=true")
      .set(s.as(member.token))
      .expect(403);
    const staffView = (
      await api
        .get("/api/v1/routes?includeInactive=true")
        .set(s.as(s.admin))
        .expect(200)
    ).body;
    assert.equal(staffView.items[0].active, false);
    const b = await t.registerMember({
      email: "b@test.example",
      facultyId: s.faculty.id,
      categoryId: s.category.id,
    });
    await s
      .post("/subscriptions", { planId: s.plan.id, routeId: s.route.id }, b)
      .expect(400);
    await s
      .post(
        "/bookings",
        {
          tripId: trip.id,
          boardingStopId: s.route.stops[0].id,
          idempotencyKey: randomUUID(),
        },
        member.token,
      )
      .expect(409);
    // The existing booking is kept.
    const mine = (
      await api.get("/api/v1/bookings/mine").set(s.as(member.token)).expect(200)
    ).body;
    assert.equal(
      mine.items.find((x: any) => x.id === booked.id).status,
      "CONFIRMED",
    );

    // Reopen and rename.
    const reopened = (
      await patchRoute({
        active: true,
        name: "West route (new)",
        reason: "Back in service",
      }).expect(200)
    ).body;
    assert.deepEqual(
      [reopened.active, reopened.name],
      [true, "West route (new)"],
    );
    await s
      .post("/subscriptions", { planId: s.plan.id, routeId: s.route.id }, b)
      .expect(201);
    await patchRoute(
      { active: false, reason: "member cannot" },
      member.token,
    ).expect(403);

    const actions = (
      await t.database.query(
        "SELECT action FROM audit_events WHERE entity_id=$1",
        [s.route.id],
      )
    ).rows.map((r: any) => r.action);
    for (const a of ["ROUTE_CLOSED", "ROUTE_REOPENED"])
      assert.ok(actions.includes(a), a);
  } finally {
    await t.close();
  }
});

test("booking emails say drop-off stop on the return trip", () => {
  const facts = {
    name: "x",
    routeName: "الخط الغربي",
    boardingStopName: "المريوطية",
    departureAt: "2026-11-01T13:00:00Z",
  };
  assert.match(
    renderTemplate("BOOKING_CONFIRMED", { ...facts, direction: "OUTBOUND" })
      .text,
    /محطة الركوب: المريوطية/,
  );
  assert.match(
    renderTemplate("BOOKING_CONFIRMED", { ...facts, direction: "RETURN" }).text,
    /محطة النزول: المريوطية/,
  );
});
