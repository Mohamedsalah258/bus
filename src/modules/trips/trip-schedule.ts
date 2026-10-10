import { BadRequestException } from "@nestjs/common";

export interface TripSchedule {
  departureAt: string;
  arrivalAt: string;
  bookingClosesAt: string;
  cancellationClosesAt: string;
}

/**
 * Pure rule: departure and both cutoffs are in the future, arrival follows
 * departure, and neither cutoff is later than departure.
 */
export function assertValidTripSchedule(
  schedule: TripSchedule,
  now = Date.now(),
) {
  const departure = Date.parse(schedule.departureAt);
  const arrival = Date.parse(schedule.arrivalAt);
  const bookingCloses = Date.parse(schedule.bookingClosesAt);
  const cancellationCloses = Date.parse(schedule.cancellationClosesAt);
  const valid =
    [departure, arrival, bookingCloses, cancellationCloses].every(
      Number.isFinite,
    ) &&
    departure > now &&
    arrival > departure &&
    bookingCloses <= departure &&
    bookingCloses > now &&
    cancellationCloses <= departure &&
    cancellationCloses > now;
  if (!valid)
    throw new BadRequestException(
      "Use future departure and cutoff times, with arrival after departure and cutoffs no later than departure.",
    );
}
