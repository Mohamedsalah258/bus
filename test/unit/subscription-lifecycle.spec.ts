import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  SUBSCRIPTION_STATUSES,
  TRANSITIONS,
} from "../../src/modules/subscriptions/subscription-status.js";

test("the transition table allows exactly the documented moves", () => {
  const allowed = new Set<string>();
  for (const [name, rule] of Object.entries(TRANSITIONS))
    for (const from of rule.from)
      for (const to of rule.to) allowed.add(`${name}:${from}->${to}`);
  assert.deepEqual([...allowed].sort(), [
    "reinstate:SUSPENDED->APPROVED",
    "resubmit:NEEDS_INFO->PENDING",
    "review:PENDING->APPROVED",
    "review:PENDING->NEEDS_INFO",
    "review:PENDING->REJECTED",
    "suspend:APPROVED->SUSPENDED",
    "withdraw:NEEDS_INFO->WITHDRAWN",
    "withdraw:PENDING->WITHDRAWN",
  ]);
});

test("final statuses cannot move anywhere", () => {
  for (const from of ["REJECTED", "WITHDRAWN"] as const)
    for (const name of Object.keys(TRANSITIONS) as (keyof typeof TRANSITIONS)[])
      for (const to of SUBSCRIPTION_STATUSES)
        assert.equal(
          canTransition(name, from, to),
          false,
          `${name} ${from}->${to}`,
        );
});
