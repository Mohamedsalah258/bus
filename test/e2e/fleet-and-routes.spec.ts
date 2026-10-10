import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../support/test-app.js";
import { operatingScenario } from "../support/scenario.js";

test("BL-10 (fleet): edit and retire buses and drivers; route defaults; driver phone only for passengers", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const { api } = t;

    // Drivers carry a phone; the route records its usual bus and driver.
    const driver = (
      await s
        .post("/drivers", { name: "مصطفى ليثي", phone: "+20 127 187 6984" })
        .expect(201)
    ).body;
    assert.equal(driver.phone, "01271876984");
    await s.post("/drivers", { name: "Bad phone", phone: "12345" }).expect(400);
    const bus = (
      await s
        .post("/vehicles", { plate: "و ب ا 3624", capacity: 50 })
        .expect(201)
    ).body;
    const withDefaults = (
      await api
        .put(`/api/v1/routes/${s.route.id}/defaults`)
        .set(s.as(s.admin))
        .send({
          defaultVehicleId: bus.id,
          defaultDriverId: driver.id,
          reason: "Dedicated bus",
        })
        .expect(200)
    ).body;
    assert.deepEqual(
      [withDefaults.defaultVehicleId, withDefaults.defaultDriverId],
      [bus.id, driver.id],
    );

    // Real seat count arrives: correct it, audited with a reason.
    const fixed = (
      await api
        .patch(`/api/v1/vehicles/${bus.id}`)
        .set(s.as(s.admin))
        .send({
          capacity: 45,
          reason: "Seat count confirmed by the transport office",
        })
        .expect(200)
    ).body;
    assert.equal(fixed.capacity, 45);
    await api
      .patch(`/api/v1/vehicles/${bus.id}`)
      .set(s.as(s.admin))
      .send({ capacity: 45 })
      .expect(400);

    // Retiring is refused while the route still names it as default.
    const refused = await api
      .patch(`/api/v1/vehicles/${bus.id}`)
      .set(s.as(s.admin))
      .send({ active: false, reason: "Out of service" })
      .expect(409);
    assert.match(refused.body.message, /West route/);

    // A passenger with a confirmed booking sees the driver; others never do.
    const a = await s.member("a@test.example");
    const trip = await s.trip();
    const booking = (await s.book(trip.id, a.token).expect(201)).body;
    const tripDriver = (
      await t.database.query("SELECT driver_id FROM trips WHERE id=$1", [
        trip.id,
      ])
    ).rows[0].driver_id;
    await api
      .patch(`/api/v1/drivers/${tripDriver}`)
      .set(s.as(s.admin))
      .send({ phone: "01120096250", reason: "Phone on file" })
      .expect(200);
    const mine = (
      await api.get("/api/v1/bookings/mine").set(s.as(a.token)).expect(200)
    ).body;
    assert.equal(mine.items[0].driverPhone, "01120096250");
    await api
      .patch(`/api/v1/bookings/${booking.id}/cancel`)
      .set(s.as(a.token))
      .expect(200);
    const after = (
      await api.get("/api/v1/bookings/mine").set(s.as(a.token)).expect(200)
    ).body;
    assert.deepEqual(
      [after.items[0].driverName, after.items[0].driverPhone],
      [null, null],
    );

    // The trip's driver cannot be retired while the trip is upcoming.
    await api
      .patch(`/api/v1/drivers/${tripDriver}`)
      .set(s.as(s.admin))
      .send({ active: false, reason: "Leaving" })
      .expect(409);
    await s
      .post(`/trips/${trip.id}/cancel`, { reason: "Test cleanup" })
      .expect(200);
    await api
      .patch(`/api/v1/drivers/${tripDriver}`)
      .set(s.as(s.admin))
      .send({ active: false, reason: "Leaving" })
      .expect(200);

    // Members cannot edit the fleet; the audit trail never stores phones.
    await api
      .patch(`/api/v1/vehicles/${bus.id}`)
      .set(s.as(a.token))
      .send({ capacity: 10, reason: "member" })
      .expect(403);
    const audit = await t.database.query(
      "SELECT metadata::text AS m FROM audit_events WHERE action='FLEET_UPDATED'",
    );
    assert.ok(audit.rows.length >= 3);
    assert.ok(audit.rows.every((r: any) => !r.m.includes("01120096250")));
  } finally {
    await t.close();
  }
});
