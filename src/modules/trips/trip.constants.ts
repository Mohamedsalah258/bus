export const TripDirection = {
  Outbound: "OUTBOUND",
  Return: "RETURN",
} as const;

export type TripDirection = (typeof TripDirection)[keyof typeof TripDirection];

export const TRIP_DIRECTIONS = Object.values(TripDirection);

export const TripStatus = {
  Draft: "DRAFT",
  Published: "PUBLISHED",
  Closed: "CLOSED",
  InProgress: "IN_PROGRESS",
  Completed: "COMPLETED",
  Cancelled: "CANCELLED",
} as const;

export type TripStatus = (typeof TripStatus)[keyof typeof TripStatus];

export const TRIP_STATUSES = Object.values(TripStatus);

/**
 * BL-12. The whole trip lifecycle in one table; anything else is 409.
 *
 *   DRAFT ─publish─▶ PUBLISHED ─close─▶ CLOSED ─start─▶ IN_PROGRESS ─complete─▶ COMPLETED
 *                        ▲  └──────────start──────────────┘
 *                        └─reopen─ CLOSED
 *   DRAFT | PUBLISHED | CLOSED ──cancel──▶ CANCELLED  (passengers notified)
 *
 * Members only ever see PUBLISHED trips. CLOSED stops new bookings early;
 * passengers may still cancel until the cancellation cutoff.
 */
export const TRIP_TRANSITIONS = {
  publish: { from: [TripStatus.Draft], to: TripStatus.Published },
  close: { from: [TripStatus.Published], to: TripStatus.Closed },
  reopen: { from: [TripStatus.Closed], to: TripStatus.Published },
  start: {
    from: [TripStatus.Published, TripStatus.Closed],
    to: TripStatus.InProgress,
  },
  complete: { from: [TripStatus.InProgress], to: TripStatus.Completed },
  cancel: {
    from: [TripStatus.Draft, TripStatus.Published, TripStatus.Closed],
    to: TripStatus.Cancelled,
  },
} as const satisfies Record<
  string,
  { from: readonly TripStatus[]; to: TripStatus }
>;

export type TripTransition = keyof typeof TRIP_TRANSITIONS;

export function canTripTransition(name: TripTransition, from: TripStatus) {
  return (TRIP_TRANSITIONS[name].from as readonly TripStatus[]).includes(from);
}
