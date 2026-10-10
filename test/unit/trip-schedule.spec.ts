import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateTripDto } from "../../src/modules/trips/dto/create-trip.dto.js";
import { assertValidTripSchedule } from "../../src/modules/trips/trip-schedule.js";

const id = "1059a2d8-7f60-4217-9700-970fa8c498d7";

test("trip timestamps must carry a zone", async () => {
  const dto = plainToInstance(CreateTripDto, {
    routeId: id,
    vehicleId: id,
    driverId: id,
    direction: "OUTBOUND",
    capacity: 2,
    departureAt: "2030-01-01T07:00:00",
    arrivalAt: "2030-01-01T09:00:00Z",
    bookingClosesAt: "2030-01-01T06:00:00Z",
    cancellationClosesAt: "2030-01-01T06:00:00Z",
  });
  assert((await validate(dto)).some((e) => e.property === "departureAt"));
});

test("trip schedule must be chronological and in the future", () => {
  const schedule = {
    departureAt: "2030-01-01T07:00:00Z",
    arrivalAt: "2030-01-01T09:00:00Z",
    bookingClosesAt: "2030-01-01T06:00:00Z",
    cancellationClosesAt: "2030-01-01T06:00:00Z",
  };
  assert.doesNotThrow(() => assertValidTripSchedule(schedule, 0));
  assert.throws(() =>
    assertValidTripSchedule(
      { ...schedule, arrivalAt: "2029-01-01T07:00:00Z" },
      0,
    ),
  );
  assert.throws(() =>
    assertValidTripSchedule(
      { ...schedule, bookingClosesAt: "2030-01-01T08:00:00Z" },
      0,
    ),
  );
  assert.throws(() =>
    assertValidTripSchedule(schedule, Date.parse("2031-01-01T00:00:00Z")),
  );
});
