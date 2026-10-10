export const GroupTripStatus = {
  Pending: "PENDING",
  NeedsInfo: "NEEDS_INFO",
  Approved: "APPROVED",
  Rejected: "REJECTED",
  Withdrawn: "WITHDRAWN",
  Cancelled: "CANCELLED",
} as const;
export type GroupTripStatus =
  (typeof GroupTripStatus)[keyof typeof GroupTripStatus];
export const GROUP_TRIP_STATUSES = Object.values(GroupTripStatus);

/**
 * D7: the transport office decides.
 *   PENDING ─approve─▶ APPROVED ─cancel─▶ CANCELLED
 *      │ ▲     └─reject─▶ REJECTED
 *      │ └resubmit─ NEEDS_INFO ◀─needs-info─ PENDING
 *      └─withdraw (also from NEEDS_INFO)─▶ WITHDRAWN
 * "Needs info" is never a rejection (FR-12).
 */
export const GROUP_TRIP_TRANSITIONS = {
  approve: {
    by: "office",
    from: [GroupTripStatus.Pending],
    to: GroupTripStatus.Approved,
  },
  reject: {
    by: "office",
    from: [GroupTripStatus.Pending, GroupTripStatus.NeedsInfo],
    to: GroupTripStatus.Rejected,
  },
  needsInfo: {
    by: "office",
    from: [GroupTripStatus.Pending],
    to: GroupTripStatus.NeedsInfo,
  },
  cancel: {
    by: "office",
    from: [GroupTripStatus.Approved],
    to: GroupTripStatus.Cancelled,
  },
  resubmit: {
    by: "requester",
    from: [GroupTripStatus.NeedsInfo],
    to: GroupTripStatus.Pending,
  },
  withdraw: {
    by: "requester",
    from: [GroupTripStatus.Pending, GroupTripStatus.NeedsInfo],
    to: GroupTripStatus.Withdrawn,
  },
} as const;
export type GroupTripTransition = keyof typeof GROUP_TRIP_TRANSITIONS;

export const canGroupTripTransition = (
  name: GroupTripTransition,
  from: GroupTripStatus,
) =>
  (GROUP_TRIP_TRANSITIONS[name].from as readonly GroupTripStatus[]).includes(
    from,
  );
