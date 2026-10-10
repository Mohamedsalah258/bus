import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTripTransition,
  TRIP_STATUSES,
  TRIP_TRANSITIONS,
} from "../../src/modules/trips/trip.constants.js";

test("trip transition table allows exactly the documented moves", () => {
  const allowed = Object.entries(TRIP_TRANSITIONS)
    .flatMap(([name, rule]) =>
      rule.from.map((from) => `${name}:${from}->${rule.to}`),
    )
    .sort();
  assert.deepEqual(allowed, [
    "cancel:CLOSED->CANCELLED",
    "cancel:DRAFT->CANCELLED",
    "cancel:PUBLISHED->CANCELLED",
    "close:PUBLISHED->CLOSED",
    "complete:IN_PROGRESS->COMPLETED",
    "publish:DRAFT->PUBLISHED",
    "reopen:CLOSED->PUBLISHED",
    "start:CLOSED->IN_PROGRESS",
    "start:PUBLISHED->IN_PROGRESS",
  ]);
});

test("completed and cancelled trips are final", () => {
  for (const from of ["COMPLETED", "CANCELLED"] as const)
    for (const name of Object.keys(
      TRIP_TRANSITIONS,
    ) as (keyof typeof TRIP_TRANSITIONS)[])
      assert.equal(
        canTripTransition(name, from),
        false,
        `${name} from ${from}`,
      );
  assert.equal(TRIP_STATUSES.length, 6);
});
