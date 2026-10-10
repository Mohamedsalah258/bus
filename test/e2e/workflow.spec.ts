import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BookingsService } from "../../src/modules/bookings/bookings.service.js";
import { createTestApp, nonCamelKeys } from "../support/test-app.js";

test("full HTTP workflow on embedded PostgreSQL (sequential; not a concurrent lock test)", async () => {
  const t = await createTestApp();
  const { api, database } = t;
  const camel = (body: unknown) => assert.deepEqual(nonCamelKeys(body), []);
  try {
    await api.get("/api/v1/health/live").expect(200);
    await api.get("/api/v1/routes").expect(401);
    await api.get("/api/v1/health/ready").expect(200);
    const admin = await t.adminBearer();
    const staffCategory = await t.createCategory("EMPLOYEE", "موظف");

    const faculty = (
      await api
        .post("/api/v1/faculties")
        .set("Authorization", admin)
        .send({ name: "Faculty of Science" })
        .expect(201)
    ).body;
    camel(faculty);
    await api
      .post("/api/v1/auth/register")
      .send({
        email: "member@test.example",
        password: "member test password",
        name: "Member",
        facultyId: faculty.id,
        categoryId: staffCategory.id,
        role: "ADMIN",
      })
      .expect(400);
    const registered = (
      await api
        .post("/api/v1/auth/register")
        .send({
          email: "member@test.example",
          password: "member test password",
          name: "Member",
          facultyId: faculty.id,
          categoryId: staffCategory.id,
        })
        .expect(201)
    ).body;
    camel(registered);
    const member = registered.user;
    assert.equal(member.facultyId, faculty.id);
    assert.equal(member.role, "MEMBER");
    assert.equal(member.categoryId, staffCategory.id);
    const token = await t.bearer("member@test.example", "member test password");
    const unverified = await api
      .get("/api/v1/bookings/mine")
      .set("Authorization", token)
      .expect(403);
    assert.match(unverified.body.message, /Email verification required/);
    await t.verifyEmail(token, "member@test.example");
    // Incomplete profile: no request until the phone is added.
    await api
      .post("/api/v1/subscriptions")
      .set("Authorization", token)
      .send({
        routeId: "1059a2d8-7f60-4217-9700-970fa8c498d7",
        planId: "1059a2d8-7f60-4217-9700-970fa8c498d7",
      })
      .expect(400);
    await api
      .patch("/api/v1/auth/me/profile")
      .set("Authorization", token)
      .send({ phone: "+20 101 234 5678" })
      .expect(200);
    await api
      .post("/api/v1/faculties")
      .set("Authorization", token)
      .send({ name: "Unauthorized faculty" })
      .expect(403);

    const route = (
      await api
        .post("/api/v1/routes")
        .set("Authorization", admin)
        .send({
          name: "West route",
          stops: [{ name: "Cairo University" }, { name: "BSU Campus" }],
          eligibleCategoryIds: [staffCategory.id],
        })
        .expect(201)
    ).body;
    camel(route);
    assert.deepEqual(
      route.stops.map((s: { position: number }) => s.position),
      [0, 1],
    );
    assert.deepEqual(route.eligibleCategoryIds, [staffCategory.id]);
    const season = (
      await api
        .post("/api/v1/seasons")
        .set("Authorization", admin)
        .send({
          name: "Test season",
          startsOn: "2000-01-01",
          endsOn: "2099-12-31",
        })
        .expect(201)
    ).body;
    // Calendar dates stay calendar dates, independent of the server time zone.
    assert.equal(season.startsOn, "2000-01-01");
    assert.equal(season.endsOn, "2099-12-31");
    const plan = await t.createPlan(season.id);
    const vehicle = (
      await api
        .post("/api/v1/vehicles")
        .set("Authorization", admin)
        .send({ plate: "TEST-001", capacity: 1 })
        .expect(201)
    ).body;
    const driver = (
      await api
        .post("/api/v1/drivers")
        .set("Authorization", admin)
        .send({ name: "Test Driver" })
        .expect(201)
    ).body;
    const base = Date.now() + 86400000;
    const iso = (delta: number) => new Date(base + delta).toISOString();
    const tripDto = {
      routeId: route.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      direction: "OUTBOUND",
      departureAt: iso(0),
      arrivalAt: iso(3600000),
      bookingClosesAt: iso(-3600000),
      cancellationClosesAt: iso(-3600000),
      capacity: 1,
    };
    const trip = (
      await api
        .post("/api/v1/trips")
        .set("Authorization", admin)
        .send(tripDto)
        .expect(201)
    ).body;
    camel(trip);
    assert.equal(trip.vehicleId, vehicle.id);
    await api
      .post("/api/v1/trips")
      .set("Authorization", admin)
      .send(tripDto)
      .expect(409);

    const payload = {
      tripId: trip.id,
      boardingStopId: route.stops[0].id,
      idempotencyKey: randomUUID(),
    };
    await api
      .post("/api/v1/bookings")
      .set("Authorization", token)
      .send(payload)
      .expect(403);
    const sub = (
      await api
        .post("/api/v1/subscriptions")
        .set("Authorization", token)
        .send({ routeId: route.id, planId: plan.id })
        .expect(201)
    ).body;
    camel(sub);
    assert.equal(sub.status, "PENDING");
    const reviewed = (
      await api
        .patch(`/api/v1/subscriptions/${sub.id}/review`)
        .set("Authorization", admin)
        .send({ status: "APPROVED", reason: "Eligibility checked for testing" })
        .expect(200)
    ).body;
    assert.equal(reviewed.reviewReason, "Eligibility checked for testing");
    await api
      .patch(`/api/v1/subscriptions/${sub.id}/review`)
      .set("Authorization", admin)
      .send({ status: "APPROVED", reason: "Duplicate review" })
      .expect(409);

    const booked = (
      await api
        .post("/api/v1/bookings")
        .set("Authorization", token)
        .send(payload)
        .expect(201)
    ).body;
    camel(booked);
    const retry = (
      await api
        .post("/api/v1/bookings")
        .set("Authorization", token)
        .send(payload)
        .expect(201)
    ).body;
    assert.equal(retry.id, booked.id);
    await api
      .post("/api/v1/bookings")
      .set("Authorization", token)
      .send({ ...payload, boardingStopId: route.stops[1].id })
      .expect(409);
    await api
      .patch(`/api/v1/bookings/${booked.id}/cancel`)
      .set("Authorization", admin)
      .expect(404);

    const trips = (
      await api.get("/api/v1/trips").set("Authorization", token).expect(200)
    ).body;
    camel(trips);
    assert.equal(trips.total, 1);
    assert.equal(trips.limit, 25);
    assert.equal(trips.offset, 0);
    assert.equal(trips.items[0].remainingSeats, 0);
    assert.equal(trips.items[0].vehicleId, undefined, "assignment not public");

    const other = randomUUID();
    await database.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,'other@test.example','Other','not-used')",
      [other],
    );
    await database.query(
      "INSERT INTO subscriptions(user_id,season_id,route_id,status) VALUES($1,$2,$3,'APPROVED')",
      [other, season.id, route.id],
    );
    const bookings = t.app.get(BookingsService);
    await assert.rejects(
      bookings.create({ ...payload, idempotencyKey: randomUUID() }, other),
      /full/,
    );
    await api
      .patch(`/api/v1/bookings/${booked.id}/cancel`)
      .set("Authorization", token)
      .expect(200);
    await api
      .patch(`/api/v1/bookings/${booked.id}/cancel`)
      .set("Authorization", token)
      .expect(200);
    const stillCancelled = (
      await api
        .post("/api/v1/bookings")
        .set("Authorization", token)
        .send(payload)
        .expect(201)
    ).body;
    assert.equal(stillCancelled.status, "CANCELLED");
    const otherBooking = await bookings.create(
      { ...payload, idempotencyKey: randomUUID() },
      other,
    );
    assert.equal(otherBooking.status, "CONFIRMED");

    const own = (
      await api
        .get("/api/v1/bookings/mine")
        .set("Authorization", token)
        .expect(200)
    ).body;
    camel(own);
    assert.equal(own.total, 1);
    assert.equal(own.items[0].userId, member.id);
    assert.equal(own.items[0].boardingStopName, "Cairo University");

    const paged = (
      await api.get("/api/v1/faculties?limit=1&offset=5").expect(200)
    ).body;
    assert.deepEqual(paged.items, []);
    assert.equal(paged.total, 1, "total ignores paging");

    const audit = (
      await api
        .get("/api/v1/audit-events")
        .set("Authorization", admin)
        .expect(200)
    ).body;
    // metadata is free-form JSON; check the record's own keys only.
    for (const event of audit.items)
      assert.deepEqual(nonCamelKeys({ ...event, metadata: {} }), []);
    assert(audit.items.some((x: any) => x.action === "BOOKING_CANCELLED"));
    await api
      .post("/api/v1/auth/logout")
      .set("Authorization", token)
      .expect(204);
    await api.get("/api/v1/auth/me").set("Authorization", token).expect(401);
  } finally {
    await t.close();
  }
});
