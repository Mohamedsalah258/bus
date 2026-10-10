import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ADMIN, createTestApp } from "../support/test-app.js";

/**
 * The old cars.bsu.edu.eg screens, mapped onto the new API:
 *  طلب الاشتراك  → email code + one form (POST /subscriptions/apply)
 *  حجز أتوبيس    → email code + booking
 *  اعرف حجوزاتك  → email code + /bookings/mine (no national ID)
 */
test("old-site parity: password-free sign-in, one subscription form, own bookings only", async () => {
  const t = await createTestApp();
  const { api, database } = t;
  try {
    const admin = await t.adminBearer();
    const as = (token: string) => ({ Authorization: token });
    const post = (path: string, body: object, token = admin) =>
      api.post(`/api/v1${path}`).set(as(token)).send(body);

    const faculty = (await post("/faculties", { name: "Science" }).expect(201))
      .body;
    const category = await t.createCategory("FACULTY_MEMBER", "عضو هيئة تدريس");
    const route = (
      await post("/routes", {
        name: "Cairo - Beni Suef",
        stops: [{ name: "Ramses" }, { name: "Campus" }],
        eligibleCategoryIds: [category.id],
      }).expect(201)
    ).body;
    const season = (
      await post("/seasons", {
        name: "2026/2027",
        startsOn: "2000-01-01",
        endsOn: "2099-12-31",
      }).expect(201)
    ).body;
    const plan = await t.createPlan(season.id);

    // ---- Sign in with a code: no registration, no password -------------
    const email = "dr.mona@bsu.edu.eg";
    const requested = await post("/auth/code/request", { email }, "").expect(
      202,
    );
    const unknown = await post(
      "/auth/code/request",
      { email: "nobody@bsu.edu.eg" },
      "",
    ).expect(202);
    assert.deepEqual(requested.body, unknown.body, "same answer for any email");
    const code = await signInCode(email);
    const wrong = code === "000000" ? "111111" : "000000";
    await post("/auth/code/verify", { email, code: wrong }, "").expect(400);
    const tokens = (
      await post("/auth/code/verify", { email, code }, "").expect(200)
    ).body;
    await post("/auth/code/verify", { email, code }, "").expect(400); // single use
    const member = `Bearer ${tokens.accessToken}`;

    const me = (await api.get("/api/v1/auth/me").set(as(member)).expect(200))
      .body;
    assert.deepEqual(
      [me.role, me.emailVerified, me.profileComplete, me.name],
      ["MEMBER", true, false, null],
    );

    // ---- The old subscription form, in one request -----------------------
    const form = {
      name: "منى أحمد محمد علي",
      phone: "0101 234 5678",
      jobTitle: "مدرس",
      facultyId: faculty.id,
      categoryId: category.id,
      planId: plan.id,
      routeId: route.id,
    };
    await post(
      "/subscriptions/apply",
      { ...form, phone: "12345" },
      member,
    ).expect(400);
    await post(
      "/subscriptions/apply",
      { ...form, nationalId: "29001011234567" },
      member,
    ).expect(400);
    const sub = (await post("/subscriptions/apply", form, member).expect(201))
      .body;
    assert.equal(sub.status, "PENDING");
    assert.deepEqual(
      [sub.applicantName, sub.applicantPhone, sub.applicantJobTitle],
      ["منى أحمد محمد علي", "01012345678", "مدرس"],
    );
    const after = (await api.get("/api/v1/auth/me").set(as(member)).expect(200))
      .body;
    assert.equal(after.profileComplete, true);

    // A refused request leaves the profile untouched (one transaction).
    const otherCategory = await t.createCategory("EMPLOYEE", "موظف");
    await post(
      "/subscriptions/apply",
      { ...form, categoryId: otherCategory.id, name: "Changed Name" },
      member,
    ).expect(403);
    const unchanged = (
      await api.get("/api/v1/auth/me").set(as(member)).expect(200)
    ).body;
    assert.deepEqual(
      [unchanged.name, unchanged.categoryId],
      [form.name, category.id],
    );

    // The reviewer sees what the old form collected, minus national ID and address.
    const queue = (
      await api
        .get("/api/v1/subscriptions?status=PENDING")
        .set(as(admin))
        .expect(200)
    ).body;
    assert.equal(queue.items[0].applicantJobTitle, "مدرس");
    await api
      .patch(`/api/v1/subscriptions/${sub.id}/review`)
      .set(as(admin))
      .send({ status: "APPROVED", reason: "Faculty member, verified" })
      .expect(200);

    // ---- Booking, and «اعرف حجوزاتك» --------------------------------------
    const vehicle = (
      await post("/vehicles", { plate: "BUS-1", capacity: 40 }).expect(201)
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
        capacity: 40,
      }).expect(201)
    ).body;
    await post(
      "/bookings",
      {
        tripId: trip.id,
        boardingStopId: route.stops[0].id,
        idempotencyKey: randomUUID(),
      },
      member,
    ).expect(201);

    // Next visit: sign in again with a new code, same account.
    await database.query(
      "UPDATE email_otps SET created_at = created_at - interval '2 minutes'",
    );
    await post("/auth/code/request", { email }, "").expect(202);
    const again = (
      await post(
        "/auth/code/verify",
        { email, code: await signInCode(email) },
        "",
      ).expect(200)
    ).body;
    const mine = (
      await api
        .get("/api/v1/bookings/mine")
        .set(as(`Bearer ${again.accessToken}`))
        .expect(200)
    ).body;
    assert.equal(mine.total, 1);
    const users = await database.query(
      "SELECT count(*)::int AS n FROM users WHERE email=$1",
      [email],
    );
    assert.equal(users.rows[0].n, 1);

    // ---- Staff never sign in by code -------------------------------------
    await post("/auth/code/request", { email: ADMIN.email }, "").expect(202);
    const staffCodes = await database.query(
      "SELECT count(*)::int AS n FROM email_otps WHERE email=$1",
      [ADMIN.email],
    );
    assert.equal(staffCodes.rows[0].n, 0);

    // Members may not move their own faculty when they are staff; members can.
    await api
      .patch("/api/v1/auth/me/profile")
      .set(as(admin))
      .send({ facultyId: faculty.id })
      .expect(403);
    await api
      .patch("/api/v1/auth/me/profile")
      .set(as(admin))
      .send({ phone: "01111111111" })
      .expect(200);

    // No password exists: password login fails like any wrong password.
    await post(
      "/auth/login",
      { email, password: "any password at all" },
      "",
    ).expect(401);
  } finally {
    await t.close();
  }

  async function signInCode(email: string) {
    const { rows } = await t.database.query(
      "SELECT payload->>'code' AS code FROM notifications WHERE to_email=$1 AND template='SIGN_IN_CODE' ORDER BY created_at DESC LIMIT 1",
      [email],
    );
    assert.ok(rows[0]?.code, "no sign-in code queued");
    return rows[0].code as string;
  }
});
