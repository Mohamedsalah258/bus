export const SubscriptionStatus = {
  Pending: "PENDING",
  NeedsInfo: "NEEDS_INFO",
  Approved: "APPROVED",
  Rejected: "REJECTED",
  Suspended: "SUSPENDED",
  Withdrawn: "WITHDRAWN",
} as const;

export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const SUBSCRIPTION_STATUSES = Object.values(SubscriptionStatus);

/** Statuses that still occupy a plan + route for the applicant. */
export const LIVE_STATUSES: readonly SubscriptionStatus[] = [
  SubscriptionStatus.Pending,
  SubscriptionStatus.NeedsInfo,
  SubscriptionStatus.Approved,
  SubscriptionStatus.Suspended,
];

export const REVIEW_DECISIONS = [
  SubscriptionStatus.Approved,
  SubscriptionStatus.Rejected,
  SubscriptionStatus.NeedsInfo,
] as const;

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const PaymentStatus = {
  NotRequired: "NOT_REQUIRED",
  Unpaid: "UNPAID",
  Paid: "PAID",
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER",
  "SALARY_DEDUCTION",
  "OTHER",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * The whole lifecycle in one table: who may move a subscription from which
 * statuses to which. Anything not listed is refused with 409.
 *
 *   PENDING ──review──▶ APPROVED ──suspend──▶ SUSPENDED
 *      │  ▲                ▲                      │
 *      │  └─resubmit─┐     └──────reinstate───────┘
 *      ├─review──▶ NEEDS_INFO
 *      ├─review──▶ REJECTED              (final; apply again)
 *      └─withdraw (also from NEEDS_INFO) ▶ WITHDRAWN (final)
 */
export const TRANSITIONS = {
  review: {
    by: "staff",
    from: [SubscriptionStatus.Pending],
    to: REVIEW_DECISIONS,
  },
  resubmit: {
    by: "owner",
    from: [SubscriptionStatus.NeedsInfo],
    to: [SubscriptionStatus.Pending],
  },
  withdraw: {
    by: "owner",
    from: [SubscriptionStatus.Pending, SubscriptionStatus.NeedsInfo],
    to: [SubscriptionStatus.Withdrawn],
  },
  suspend: {
    by: "staff",
    from: [SubscriptionStatus.Approved],
    to: [SubscriptionStatus.Suspended],
  },
  reinstate: {
    by: "staff",
    from: [SubscriptionStatus.Suspended],
    to: [SubscriptionStatus.Approved],
  },
} as const satisfies Record<
  string,
  {
    by: "staff" | "owner";
    from: readonly SubscriptionStatus[];
    to: readonly SubscriptionStatus[];
  }
>;

export type TransitionName = keyof typeof TRANSITIONS;

export function canTransition(
  name: TransitionName,
  from: SubscriptionStatus,
  to: SubscriptionStatus,
) {
  const rule = TRANSITIONS[name];
  return (
    (rule.from as readonly SubscriptionStatus[]).includes(from) &&
    (rule.to as readonly SubscriptionStatus[]).includes(to)
  );
}
