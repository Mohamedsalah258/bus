import { randomUUID } from "node:crypto";
import { createTestApp } from "./test-app.js";

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/**
 * A ready operating context: faculty, category, route, season, free annual
 * plan, vehicle and driver. Trips and members are added per test.
 */
export async function operatingScenario(t: TestApp) {
  const admin = await t.adminBearer();
  const as = (token: string) => ({ Authorization: token });
  const post = (path: string, body: object, token = admin) =>
    t.api.post(`/api/v1${path}`).set(as(token)).send(body);
  const patch = (path: string, body: object, token = admin) =>
    t.api.patch(`/api/v1${path}`).set(as(token)).send(body);

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
  const plan = await t.createPlan(season.id);
  let plate = 0;

  const trip = async (
    opts: { publish?: boolean; capacity?: number; dayOffset?: number } = {},
  ) => {
    const vehicle = (
      await post("/vehicles", { plate: `BUS-${++plate}`, capacity: 40 }).expect(
        201,
      )
    ).body;
    const driver = (
      await post("/drivers", { name: `Driver ${plate}` }).expect(201)
    ).body;
    const base = Date.now() + (opts.dayOffset ?? 1) * 86_400_000;
    const iso = (ms: number) => new Date(base + ms).toISOString();
    return (
      await post("/trips", {
        routeId: route.id,
        vehicleId: vehicle.id,
        driverId: driver.id,
        direction: "OUTBOUND",
        departureAt: iso(0),
        arrivalAt: iso(3_600_000),
        bookingClosesAt: iso(-3_600_000),
        cancellationClosesAt: iso(-3_600_000),
        capacity: opts.capacity ?? 10,
        ...(opts.publish === undefined ? {} : { publish: opts.publish }),
      }).expect(201)
    ).body as {
      id: string;
      status: string;
      vehicleId: string;
      driverId: string;
      departureAt: string;
      arrivalAt: string;
    };
  };

  /** Registered, verified, approved member. */
  const member = async (email: string) => {
    const token = await t.registerMember({
      email,
      facultyId: faculty.id,
      categoryId: category.id,
    });
    const sub = (
      await post(
        "/subscriptions",
        { planId: plan.id, routeId: route.id },
        token,
      ).expect(201)
    ).body;
    await patch(`/subscriptions/${sub.id}/review`, {
      status: "APPROVED",
      reason: "Verified",
    }).expect(200);
    return { token, subscriptionId: sub.id as string };
  };

  const book = (tripId: string, token: string) =>
    post(
      "/bookings",
      {
        tripId,
        boardingStopId: route.stops[0].id,
        idempotencyKey: randomUUID(),
      },
      token,
    );

  const emails = async (template: string) =>
    (
      await t.database.query(
        'SELECT to_email AS "to", payload FROM notifications WHERE template=$1 ORDER BY created_at',
        [template],
      )
    ).rows as Array<{ to: string; payload: any }>;

  return {
    admin,
    as,
    post,
    patch,
    faculty,
    category,
    route,
    season,
    plan,
    trip,
    member,
    book,
    emails,
  };
}
