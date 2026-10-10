export const ComplaintStatus = {
  Open: "OPEN",
  InProgress: "IN_PROGRESS",
  Resolved: "RESOLVED",
  Closed: "CLOSED",
} as const;
export type ComplaintStatus =
  (typeof ComplaintStatus)[keyof typeof ComplaintStatus];
export const COMPLAINT_STATUSES = Object.values(ComplaintStatus);

export const COMPLAINT_KINDS = ["COMPLAINT", "SUGGESTION"] as const;
export type ComplaintKind = (typeof COMPLAINT_KINDS)[number];

/**
 *   OPEN ─assign─▶ IN_PROGRESS ─resolve─▶ RESOLVED ─close─▶ CLOSED
 *     └────────────resolve──────────────▲    │
 *                     ▲──author replies──────┘
 *   The author or staff may close at any time before CLOSED.
 */
export const COMPLAINT_TRANSITIONS = {
  assign: {
    from: [ComplaintStatus.Open, ComplaintStatus.InProgress],
    to: ComplaintStatus.InProgress,
  },
  resolve: {
    from: [ComplaintStatus.Open, ComplaintStatus.InProgress],
    to: ComplaintStatus.Resolved,
  },
  reopen: { from: [ComplaintStatus.Resolved], to: ComplaintStatus.InProgress },
  close: {
    from: [
      ComplaintStatus.Open,
      ComplaintStatus.InProgress,
      ComplaintStatus.Resolved,
    ],
    to: ComplaintStatus.Closed,
  },
} as const;

export type ComplaintTransition = keyof typeof COMPLAINT_TRANSITIONS;

export const canComplaintTransition = (
  name: ComplaintTransition,
  from: ComplaintStatus,
) =>
  (COMPLAINT_TRANSITIONS[name].from as readonly ComplaintStatus[]).includes(
    from,
  );

/** Anti-abuse: complaints one account may file in 24 hours. */
export const MAX_COMPLAINTS_PER_DAY = 10;
