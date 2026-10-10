import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestApp } from "../support/test-app.js";
import { operatingScenario } from "../support/scenario.js";

test("BL-11: staff-defined recurring schedule → trips (Saturday week, holidays, DST, conflicts, seats)", async () => {
  const t = await createTestApp();
  try {
    const s = await operatingScenario(t);
    const { api, database } = t;
    const put = (path: string, body: object) =>
      api.put(`/api/v1${path}`).set(s.as(s.admin)).send(body);
    const patch = (path: string, body: object) =>
      api.patch(`/api/v1${path}`).set(s.as(s.admin)).send(body);

    const bus = (
      await s.post("/vehicles", { plate: "SCHED-1", capacity: 40 }).expect(201)
    ).body;
    const driver = (
      await s.post("/drivers", { name: "Schedule Driver" }).expect(201)
    ).body;
    await put(`/routes/${s.route.id}/defaults`, {
      defaultVehicleId: bus.id,
      defaultDriverId: driver.id,
      reason: "Dedicated bus",
    }).expect(200);

    // Admin decides everything: time, days (Saturday→Thursday), seats, cutoffs.
    const template = (
      await s
        .post("/schedules", {
          routeId: s.route.id,
          name: "ذهاب الصباح",
          direction: "OUTBOUND",
          departureTime: "06:30",
          durationMinutes: 120,
          weekdays: ["SAT", "SUN", "MON", "TUE", "WED", "THU"],
          validFrom: "2030-10-01",
          validUntil: "2031-06-30",
          capacity: 30,
          bookingCloseMinutes: 720,
          cancellationCloseMinutes: 720,
        })
        .expect(201)
    ).body;
    assert.deepEqual(template.weekdays, [
      "SAT",
      "SUN",
      "MON",
      "TUE",
      "WED",
      "THU",
    ]);
    await s
      .post("/schedules", { ...template, id: undefined, weekdays: ["XYZ"] })
      .expect(400);

    // A holiday set by the admin.
    await s
      .post("/service-exceptions", {
        date: "2030-11-03",
        reason: "إجازة رسمية",
      })
      .expect(201);

    // Expected dates: no Fridays, no holiday.
    const expected: string[] = [];
    for (
      let d = Date.parse("2030-10-26");
      d <= Date.parse("2030-11-08");
      d += 86_400_000
    ) {
      const day = new Date(d);
      const iso = day.toISOString().slice(0, 10);
      if (day.getUTCDay() !== 5 && iso !== "2030-11-03") expected.push(iso);
    }
    const range = { from: "2030-10-26", to: "2030-11-08" };

    // Dry run previews without saving.
    const preview = (
      await s
        .post(`/schedules/${template.id}/generate`, { ...range, dryRun: true })
        .expect(200)
    ).body;
    assert.deepEqual(
      [preview.dryRun, preview.created],
      [true, expected.length],
    );
    assert.deepEqual(preview.skippedHolidays, ["2030-11-03"]);
    const none = await database.query(
      "SELECT count(*)::int AS n FROM trips WHERE template_id=$1",
      [template.id],
    );
    assert.equal(none.rows[0].n, 0);

    const report = (
      await s.post(`/schedules/${template.id}/generate`, range).expect(200)
    ).body;
    assert.deepEqual(report.createdDates, expected);

    // Cairo wall-clock 06:30 on both sides of the DST change (last Thursday of October).
    const times = await database.query(
      `SELECT service_date::text AS d, to_char(departure_at AT TIME ZONE 'UTC','HH24:MI') AS utc,
              to_char(departure_at AT TIME ZONE 'Africa/Cairo','HH24:MI') AS cairo, capacity
         FROM trips WHERE template_id=$1 AND service_date IN ('2030-10-27','2030-11-04') ORDER BY 1`,
      [template.id],
    );
    assert.deepEqual(
      times.rows.map((r: any) => [r.d, r.cairo, r.utc, r.capacity]),
      [
        ["2030-10-27", "06:30", "03:30", 30],
        ["2030-11-04", "06:30", "04:30", 30],
      ],
    );

    // Generating again creates nothing new.
    const again = (
      await s.post(`/schedules/${template.id}/generate`, range).expect(200)
    ).body;
    assert.deepEqual(
      [again.created, again.skippedExisting.length],
      [0, expected.length],
    );

    // Same bus at an overlapping time: reported as conflicts, not created.
    const clash = (
      await s
        .post("/schedules", {
          routeId: s.route.id,
          name: "Overlapping",
          direction: "OUTBOUND",
          departureTime: "07:00",
          durationMinutes: 60,
          weekdays: ["SAT"],
          validFrom: "2030-10-01",
          validUntil: "2030-12-31",
          bookingCloseMinutes: 60,
          cancellationCloseMinutes: 60,
        })
        .expect(201)
    ).body;
    const clashReport = (
      await s.post(`/schedules/${clash.id}/generate`, range).expect(200)
    ).body;
    assert.equal(clashReport.created, 0);
    assert.equal(clashReport.conflicts.length, 2); // two Saturdays in range

    // Members see the generated trips and can book them.
    const member = await s.member("a@test.example");
    const other = await s.member("b@test.example");
    const trip = (
      await database.query(
        "SELECT id FROM trips WHERE template_id=$1 AND service_date='2030-10-27'",
        [template.id],
      )
    ).rows[0].id;
    for (const token of [member.token, other.token])
      await s.book(trip, token).expect(201);

    // Seats per trip: admin decides, within the bus and above what is booked.
    await patch(`/trips/${trip}/capacity`, {
      capacity: 1,
      reason: "Smaller bus",
    }).expect(409);
    await patch(`/trips/${trip}/capacity`, {
      capacity: 41,
      reason: "Too many",
    }).expect(400);
    const resized = (
      await patch(`/trips/${trip}/capacity`, {
        capacity: 20,
        reason: "Half the bus reserved",
      }).expect(200)
    ).body;
    assert.equal(resized.capacity, 20);

    // Editing the schedule changes future generations only.
    await patch(`/schedules/${template.id}`, { departureTime: "07:15" }).expect(
      200,
    );
    const unchanged = await database.query(
      "SELECT to_char(departure_at AT TIME ZONE 'Africa/Cairo','HH24:MI') AS t FROM trips WHERE id=$1",
      [trip],
    );
    assert.equal(unchanged.rows[0].t, "06:30");
    const later = (
      await s
        .post(`/schedules/${template.id}/generate`, {
          from: "2030-11-09",
          to: "2030-11-09",
        })
        .expect(200)
    ).body;
    assert.equal(later.created, 1);
    const newTime = await database.query(
      "SELECT to_char(departure_at AT TIME ZONE 'Africa/Cairo','HH24:MI') AS t FROM trips WHERE template_id=$1 AND service_date='2030-11-09'",
      [template.id],
    );
    assert.equal(newTime.rows[0].t, "07:15");

    // Holiday list reports trips already scheduled that day.
    const holiday = (
      await s
        .post("/service-exceptions", { date: "2030-10-28", reason: "Closure" })
        .expect(201)
    ).body;
    assert.equal(holiday.tripsThatDay, 1);

    // Members cannot manage schedules.
    await s.post("/schedules", {}, member.token).expect(403);
    await s
      .post(`/schedules/${template.id}/generate`, range, member.token)
      .expect(403);
    void randomUUID;
  } finally {
    await t.close();
  }
});
