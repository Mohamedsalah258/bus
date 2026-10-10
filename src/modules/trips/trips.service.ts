import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { toPage } from "../../common/dto/page.dto.js";
import { Database } from "../../database/database.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import { BookingNotifier } from "../bookings/booking-notifier.js";
import { BookingsRepository } from "../bookings/bookings.repository.js";
import { DriversRepository } from "../fleet/drivers.repository.js";
import { VehiclesRepository } from "../fleet/vehicles.repository.js";
import { RoutesRepository } from "../routes/routes.repository.js";
import { CreateTripDto } from "./dto/create-trip.dto.js";
import { ListTripsQueryDto } from "./dto/list-trips-query.dto.js";
import { TripScheduleQueryDto } from "./dto/trip-actions.dto.js";
import { TripCancellationResponse, TripResponse } from "./dto/trip.response.js";
import { assertValidTripSchedule } from "./trip-schedule.js";
import {
  canTripTransition,
  TRIP_TRANSITIONS,
  TripStatus,
  TripTransition,
} from "./trip.constants.js";
import { TripsRepository } from "./trips.repository.js";

const TRIP_AUDIT: Record<TripTransition, AuditAction> = {
  publish: AuditAction.TripPublished,
  close: AuditAction.TripClosed,
  reopen: AuditAction.TripReopened,
  start: AuditAction.TripStarted,
  complete: AuditAction.TripCompleted,
  cancel: AuditAction.TripCancelled,
};

@Injectable()
export class TripsService {
  constructor(
    private readonly db: Database,
    private readonly trips: TripsRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly drivers: DriversRepository,
    private readonly routes: RoutesRepository,
    private readonly bookings: BookingsRepository,
    private readonly notifier: BookingNotifier,
    private readonly audit: AuditService,
  ) {}

  async listUpcoming(query: ListTripsQueryDto) {
    const { items, total } = await this.trips.listUpcoming(query);
    return toPage(items, total, query);
  }

  async listSchedule(query: TripScheduleQueryDto) {
    if (Date.parse(query.to) <= Date.parse(query.from))
      throw new BadRequestException("`to` must be after `from`");
    const { items, total } = await this.trips.listSchedule(query);
    return toPage(items, total, query);
  }

  async get(id: string) {
    const trip = await this.trips.findFull(id);
    if (!trip) throw new NotFoundException();
    return trip;
  }

  create(dto: CreateTripDto, actorId: string): Promise<TripResponse> {
    assertValidTripSchedule(dto);
    return this.db.transaction(async (tx) => {
      // Lock order vehicle → driver serializes competing assignments.
      const vehicle = await this.vehicles.lockForUpdate(dto.vehicleId, tx);
      const driver = await this.drivers.lockForUpdate(dto.driverId, tx);
      if (!vehicle?.active || !driver?.active)
        throw new BadRequestException("Vehicle and driver must be active");
      if (dto.capacity > vehicle.capacity)
        throw new BadRequestException("Trip capacity exceeds vehicle capacity");
      if (!(await this.routes.isActive(dto.routeId, tx)))
        throw new BadRequestException("Route is unavailable");
      if (
        await this.trips.hasAssignmentOverlap(
          dto.vehicleId,
          dto.driverId,
          dto.departureAt,
          dto.arrivalAt,
          tx,
        )
      )
        throw new ConflictException(
          "Vehicle or driver already assigned during this time",
        );
      const trip = await this.trips.insert(dto, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.TripCreated,
        entityId: trip.id,
        metadata: { status: trip.status },
      });
      return trip;
    });
  }

  /** publish, close, reopen, start, complete (cancel has its own method). */
  transition(
    id: string,
    name: Exclude<TripTransition, "cancel">,
    actorId: string,
  ): Promise<TripResponse> {
    return this.db.transaction(async (tx) => {
      const trip = await this.lockTrip(id, tx);
      this.assertTransition(name, trip.status);
      if (name === "reopen" && (await this.trips.bookingWindowClosed(id, tx)))
        throw new ConflictException(
          "Booking cutoff has passed; the trip cannot be reopened",
        );
      const to = TRIP_TRANSITIONS[name].to;
      await this.trips.applyTransition(id, to, null, tx);
      await this.audit.record(tx, {
        actorId,
        action: TRIP_AUDIT[name],
        entityId: id,
        metadata: { from: trip.status, to },
      });
      return (await this.trips.findFull(id, tx))!;
    });
  }

  /**
   * Seats on one trip. Never below the confirmed bookings, never above the
   * bus. Lock order: trip, then counting its bookings.
   */
  setCapacity(id: string, capacity: number, reason: string, actorId: string) {
    return this.db.transaction(async (tx) => {
      const trip = await this.lockTrip(id, tx);
      if (
        trip.status !== TripStatus.Draft &&
        trip.status !== TripStatus.Published &&
        trip.status !== TripStatus.Closed
      )
        throw new ConflictException(`The trip is ${trip.status}`);
      const booked = await this.bookings.confirmedOnTrip(id, tx);
      if (capacity < booked.length)
        throw new ConflictException(
          `${booked.length} seats are already booked; cancel bookings before reducing below that`,
        );
      const vehicle = await this.vehicles.lockForUpdate(trip.vehicleId, tx);
      if (vehicle && capacity > vehicle.capacity)
        throw new BadRequestException(`The bus has ${vehicle.capacity} seats`);
      await this.trips.setCapacity(id, capacity, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.TripCapacityChanged,
        entityId: id,
        metadata: { from: trip.capacity, to: capacity, reason },
      });
      return (await this.trips.findFull(id, tx))!;
    });
  }

  /**
   * BL-13. Cancels the trip and every confirmed booking on it, in one
   * transaction, and emails each passenger the reason.
   * Lock order: trip, then its bookings (never a user lock).
   */
  cancel(
    id: string,
    reason: string,
    actorId: string,
  ): Promise<TripCancellationResponse> {
    return this.db.transaction(async (tx) => {
      const trip = await this.lockTrip(id, tx);
      this.assertTransition("cancel", trip.status);
      const affected = await this.bookings.confirmedOnTrip(id, tx);
      await this.bookings.cancelByAdmin(
        affected.map((b) => b.bookingId),
        reason,
        actorId,
        tx,
      );
      await this.trips.applyTransition(
        id,
        TripStatus.Cancelled,
        { reason, actorId },
        tx,
      );
      await this.notifier.cancelledByAdmin(affected, reason, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.TripCancelled,
        entityId: id,
        metadata: {
          from: trip.status,
          reason,
          cancelledBookings: affected.length,
        },
      });
      const updated = (await this.trips.findFull(id, tx))!;
      return { ...updated, cancelledBookings: affected.length };
    });
  }

  private async lockTrip(
    id: string,
    tx: Parameters<TripsRepository["lockForUpdate"]>[1],
  ) {
    const trip = await this.trips.lockForUpdate(id, tx);
    if (!trip) throw new NotFoundException();
    return trip;
  }

  private assertTransition(name: TripTransition, from: TripStatus) {
    if (!canTripTransition(name, from))
      throw new ConflictException(`Cannot ${name} a trip that is ${from}`);
  }
}
