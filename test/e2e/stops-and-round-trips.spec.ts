import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestApp } from "../support/test-app.js";
import { operatingScenario } from "../support/scenario.js";

test("BL-09: editing stops retires, never rewrites; history keeps the old stop", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const { api } = t;
    const put = (body: object) =>
      api
        .put(`/api/v1/routes/${s.route.id}/stops`)
        .set(s.as(s.admin))
        .send(body);
    const [cairo, campus] = s.route.stops;
    const member = await s.member("a@test.example");

    // A past booking at Cairo: completed trip.
    const trip = await s.trip();
    const booking = (await s.book(trip.id, member.token).expect(201)).body;
    // Removing a stop with an upcoming booking is refused.
    const refused = await put({
      stops: [{ id: campus.id, name: "Campus" }],
      reason: "Drop Cairo",
    }).expect(400); // < 2 stops
    void refused;
    await put({
      stops: [{ name: "Giza" }, { id: campus.id, name: "Campus" }],
      reason: "Replace Cairo",
    }).expect(409);
    await s.post(`/trips/${trip.id}/start`, {}).expect(200);
    await s.post(`/trips/${trip.id}/complete`, {}).expect(200);

    // Now Cairo is renamed (a new stop), Giza inserted, order changed.
    const v2 = (
      await put({
        stops: [
          { name: "Giza" },
          { id: cairo.id, name: "Cairo Downtown" },
          { id: campus.id, name: "Campus" },
        ],
        reason: "New stop and clearer name",
      }).expect(200)
    ).body;
    assert.equal(v2.version, 2);
    assert.deepEqual(
      v2.stops.map((x: any) => x.name),
      ["Giza", "Cairo Downtown", "Campus"],
    );
    assert.equal(
      v2.stops.find((x: any) => x.name === "Campus").id,
      campus.id,
      "kept stop keeps its id",
    );
    assert.notEqual(
      v2.stops.find((x: any) => x.name === "Cairo Downtown").id,
      cairo.id,
      "renamed = new stop",
    );

    // The old booking still shows the stop it used.
    const mine = (
      await api.get("/api/v1/bookings/mine").set(s.as(member.token)).expect(200)
    ).body;
    assert.equal(
      mine.items.find((b: any) => b.id === booking.id).boardingStopName,
      "Cairo",
    );
    // Retired stops cannot be booked; trips list the current stops.
    const next = await s.trip({ dayOffset: 2 });
    await s
      .post(
        "/bookings",
        {
          tripId: next.id,
          boardingStopId: cairo.id,
          idempotencyKey: randomUUID(),
        },
        member.token,
      )
      .expect(400);
    const list = (
      await api.get("/api/v1/trips").set(s.as(member.token)).expect(200)
    ).body;
    assert.deepEqual(
      list.items[0].stops.map((x: any) => x.name),
      ["Giza", "Cairo Downtown", "Campus"],
    );
    // Trips record the route version they were planned with.
    const versions = await t.database.query(
      "SELECT id, route_version FROM trips WHERE id = ANY($1)",
      [[trip.id, next.id]],
    );
    const byId = Object.fromEntries(
      versions.rows.map((r: any) => [r.id, r.route_version]),
    );
    assert.deepEqual([byId[trip.id], byId[next.id]], [1, 2]);

    await put({
      stops: [
        { id: "1059a2d8-7f60-4217-9700-970fa8c498d7", name: "X Y" },
        { name: "Z W" },
      ],
      reason: "bad id",
    }).expect(400);
  } finally {
    await t.close();
  }
});

test("BL-14: round trip — both legs or neither, linked cancellation", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const { api, database } = t;
    const member = await s.member("a@test.example");
    const other = await s.member("b@test.example");
    const vehicle = (
      await s.post("/vehicles", { plate: "RET-9", capacity: 1 }).expect(201)
    ).body;
    const driver = (
      await s.post("/drivers", { name: "Return Driver" }).expect(201)
    ).body;
    const outbound = await s.trip({ dayOffset: 1 });
    const base = Date.parse(outbound.arrivalAt) + 6 * 3_600_000;
    const iso = (ms: number) => new Date(base + ms).toISOString();
    const back = (
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
          capacity: 1,
        })
        .expect(201)
    ).body;
    const [cairo, campus] = s.route.stops;
    const leg = (tripId: string, stopId: string) => ({
      tripId,
      boardingStopId: stopId,
      idempotencyKey: randomUUID(),
    });
    const roundTrip = (token: string) =>
      s.post(
        "/bookings/round-trip",
        {
          outbound: leg(outbound.id, cairo.id),
          return: leg(back.id, cairo.id),
        },
        token,
      );

    // Wrong directions are refused.
    await s
      .post(
        "/bookings/round-trip",
        {
          outbound: leg(back.id, cairo.id),
          return: leg(outbound.id, cairo.id),
        },
        member.token,
      )
      .expect(400);

    const pair = (await roundTrip(member.token).expect(201)).body;
    assert.ok(
      pair.outbound.pairId && pair.outbound.pairId === pair.return.pairId,
    );

    // The return has one seat, now taken: the other member gets neither leg.
    const failed = await roundTrip(other.token).expect(409);
    assert.match(failed.body.message, /^Return trip: Trip is full/);
    const orphan = await database.query(
      "SELECT count(*)::int AS n FROM bookings b JOIN users u ON u.id=b.user_id WHERE u.email='b@test.example'",
    );
    assert.equal(orphan.rows[0].n, 0, "no silent partial confirmation");

    // Cancelling one leg with ?withPair=true cancels both.
    await api
      .patch(`/api/v1/bookings/${pair.outbound.id}/cancel?withPair=true`)
      .set(s.as(member.token))
      .expect(200);
    const mine = (
      await api.get("/api/v1/bookings/mine").set(s.as(member.token)).expect(200)
    ).body;
    assert.ok(mine.items.every((b: any) => b.status === "CANCELLED"));
    void campus;
  } finally {
    await t.close();
  }
});
