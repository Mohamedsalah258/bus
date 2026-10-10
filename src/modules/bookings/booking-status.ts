export const BookingStatus = {
  Confirmed: "CONFIRMED",
  /** By the passenger, before the cancellation cutoff. */
  Cancelled: "CANCELLED",
  /** By staff, a trip cancellation or a subscription suspension; always with a reason. */
  CancelledByAdmin: "CANCELLED_BY_ADMIN",
} as const;

export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const BOOKING_STATUSES = Object.values(BookingStatus);
