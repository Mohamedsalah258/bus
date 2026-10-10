import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Queryable } from "../../database/database.types.js";
import { toPage } from "../../common/dto/page.dto.js";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import { RoutesRepository } from "../routes/routes.repository.js";
import { SubscriptionsRepository } from "../subscriptions/subscriptions.repository.js";
import { TripDirection, TripStatus } from "../trips/trip.constants.js";
import { TripsRepository } from "../trips/trips.repository.js";
import { UsersRepository } from "../users/users.repository.js";
import { BookingNotifier } from "./booking-notifier.js";
import { BookingStatus } from "./booking-status.js";
import { BookingsRepository } from "./bookings.repository.js";
import { BookingResponse } from "./dto/booking.response.js";
import { CreateRoundTripDto, RoundTripResponse } from "./dto/round-trip.dto.js";
import { CreateBookingDto } from "./dto/create-booking.dto.js";

/**
 * Concurrency protocol (see docs/ARCHITECTURE.md):
 *   1. lock user  — serializes idempotency and per-user overlap checks
 *   2. lock trip  — serializes capacity on that trip
 * Every writer to bookings must take the locks in this order.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly db: Database,
    private readonly bookings: BookingsRepository,
    private readonly users: UsersRepository,
    private readonly trips: TripsRepository,
    private readonly subscriptions: SubscriptionsRepository,
    private readonly routes: RoutesRepository,
    private readonly notifier: BookingNotifier,
    private readonly audit: AuditService,
  ) {}

  create(dto: CreateBookingDto, userId: string): Promise<BookingResponse> {
    return this.db.transaction(async (tx) => {
      await this.users.lockForUpdate(userId, tx);
      return this.bookLeg(dto, userId, null, tx);
    });
  }

  /**
   * BL-14. Outbound and return in one transaction: both are confirmed or
   * neither is, and the error names the leg that failed. Lock order: user,
   * then both trips by id, so two round trips on the same pair never deadlock.
   */
  createRoundTrip(
    dto: CreateRoundTripDto,
    userId: string,
  ): Promise<RoundTripResponse> {
    return this.db.transaction(async (tx) => {
      await this.users.lockForUpdate(userId, tx);
      const [first, second] = [dto.outbound.tripId, dto.return.tripId].sort();
      const lockedA = await this.trips.lockForUpdate(first!, tx);
      const lockedB = await this.trips.lockForUpdate(second!, tx);
      const outbound = [lockedA, lockedB].find(
        (t) => t?.id === dto.outbound.tripId,
      );
      const back = [lockedA, lockedB].find((t) => t?.id === dto.return.tripId);
      if (!outbound || !back) throw new NotFoundException("Trip not found");
      if (
        outbound.direction !== TripDirection.Outbound ||
        back.direction !== TripDirection.Return
      )
        throw new BadRequestException(
          "Choose an outbound trip and a return trip",
        );
      if (!outbound.routeId || outbound.routeId !== back.routeId)
        throw new BadRequestException("Both trips must be on the same route");
      if (new Date(back.departureAt) < new Date(outbound.arrivalAt))
        throw new BadRequestException(
          "The return must leave after the outbound arrives",
        );

      const pairId = randomUUID();
      const leg = async (name: string, legDto: CreateBookingDto) => {
        try {
          return await this.bookLeg(legDto, userId, pairId, tx);
        } catch (error) {
          if (error instanceof HttpException)
            throw new HttpException(
              `${name}: ${String(error.message)}`,
              error.getStatus(),
            );
          throw error;
        }
      };
      const outboundBooking = await leg("Outbound trip", dto.outbound);
      const returnBooking = await leg("Return trip", dto.return);
      return { outbound: outboundBooking, return: returnBooking };
    });
  }

  /** One leg, with the user already locked. Locks its trip (re-entrant in the same transaction). */
  private async bookLeg(
    dto: CreateBookingDto,
    userId: string,
    pairId: string | null,
    tx: Queryable,
  ): Promise<BookingResponse> {
    const prior = await this.bookings.findByIdempotencyKey(
      userId,
      dto.idempotencyKey,
      tx,
    );
    if (prior) {
      if (
        prior.tripId !== dto.tripId ||
        prior.boardingStopId !== dto.boardingStopId
      )
        throw new ConflictException(
          "Idempotency key already used for a different request",
        );
      // Replay returns the original outcome, even if later cancelled.
      return prior;
    }

    const trip = await this.trips.lockForUpdate(dto.tripId, tx);
    if (!trip) throw new NotFoundException("Trip not found");
    // Group trips (BL-15) carry no route and are never publicly bookable.
    const routeId = trip.routeId;
    if (!routeId) throw new ConflictException("Booking is closed");
    if (!(await this.trips.isOpenForBooking(trip.id, tx)))
      throw new ConflictException("Booking is closed");
    if (
      !(await this.subscriptions.coversTrip(
        userId,
        routeId,
        trip.departureAt,
        tx,
      ))
    )
      throw new ForbiddenException(
        "An approved, paid (or free) subscription covering this route and travel date is required",
      );
    if (!(await this.routes.hasStop(routeId, dto.boardingStopId, tx)))
      throw new BadRequestException(
        "Boarding stop does not belong to this route",
      );
    if (
      await this.bookings.hasOverlappingConfirmed(
        userId,
        trip.departureAt,
        trip.arrivalAt,
        tx,
      )
    )
      throw new ConflictException(
        "You already have a booking during this time",
      );
    if ((await this.bookings.countConfirmed(trip.id, tx)) >= trip.capacity)
      throw new ConflictException("Trip is full");

    const booking = await this.bookings.insert(
      {
        userId,
        tripId: trip.id,
        boardingStopId: dto.boardingStopId,
        idempotencyKey: dto.idempotencyKey,
        pairId,
      },
      tx,
    );
    await this.audit.record(tx, {
      actorId: userId,
      action: AuditAction.BookingConfirmed,
      entityId: booking.id,
      ...(pairId ? { metadata: { pairId } } : {}),
    });
    // Only a new booking emails; an idempotent replay returned earlier.
    await this.notifier.confirmed(
      await this.bookings.factsFor(booking.id, tx),
      tx,
    );
    return booking;
  }

  /** Owner-only and idempotent: cancelling twice returns the same record. */
  /** With `withPair`, the other leg of a round trip is cancelled too (if still open). */
  async cancel(
    id: string,
    userId: string,
    withPair = false,
  ): Promise<BookingResponse> {
    const cancelled = await this.cancelOne(id, userId);
    if (withPair && cancelled.pairId) {
      const partner = await this.db.transaction((tx) =>
        this.bookings.partnerOf(cancelled.id, cancelled.pairId!, tx),
      );
      if (partner) await this.cancelOne(partner, userId);
    }
    return cancelled;
  }

  private cancelOne(id: string, userId: string): Promise<BookingResponse> {
    return this.db.transaction(async (tx) => {
      await this.users.lockForUpdate(userId, tx);
      const booking = await this.bookings.findOwned(id, userId, tx);
      if (!booking) throw new NotFoundException("Booking not found");
      if (booking.status !== BookingStatus.Confirmed) return booking;

      await this.trips.lockForUpdate(booking.tripId, tx);
      if (!(await this.trips.isOpenForCancellation(booking.tripId, tx)))
        throw new ConflictException(
          "Cancellation deadline has passed or trip is closed",
        );

      const cancelled = await this.bookings.markCancelled(id, tx);
      await this.audit.record(tx, {
        actorId: userId,
        action: AuditAction.BookingCancelled,
        entityId: id,
      });
      await this.notifier.cancelledByPassenger(
        await this.bookings.factsFor(id, tx),
        tx,
      );
      return cancelled;
    });
  }

  /**
   * BL-13. Staff cancel one booking with a reason, before the trip starts.
   * Lock order: trip, then booking (as in trip cancellation).
   */
  adminCancel(id: string, reason: string, actorId: string) {
    return this.db.transaction(async (tx) => {
      const current = await this.bookings.findById(id, tx);
      if (!current) throw new NotFoundException("Booking not found");
      const trip = await this.trips.lockForUpdate(current.tripId, tx);
      const booking = (await this.bookings.findById(id, tx))!;
      if (booking.status !== BookingStatus.Confirmed)
        throw new ConflictException(
          "Only a confirmed booking can be cancelled",
        );
      if (
        trip &&
        trip.status !== TripStatus.Published &&
        trip.status !== TripStatus.Closed &&
        trip.status !== TripStatus.Draft
      )
        throw new ConflictException(
          `The trip is ${trip.status}; its bookings can no longer be cancelled`,
        );
      const facts = await this.bookings.factsFor(id, tx);
      await this.bookings.cancelByAdmin([id], reason, actorId, tx);
      await this.notifier.cancelledByAdmin([facts], reason, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.BookingCancelledByAdmin,
        entityId: id,
        metadata: { reason, tripId: booking.tripId },
      });
      return (await this.bookings.findById(id, tx))!;
    });
  }

  async listMine(userId: string, page: PaginationQueryDto) {
    const { items, total } = await this.bookings.listByUser(userId, page);
    return toPage(items, total, page);
  }
}
