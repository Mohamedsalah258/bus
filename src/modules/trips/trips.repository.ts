import { Injectable } from "@nestjs/common";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { CreateTripDto } from "./dto/create-trip.dto.js";
import { ListTripsQueryDto } from "./dto/list-trips-query.dto.js";
import { TripScheduleQueryDto } from "./dto/trip-actions.dto.js";
import {
  TripListItemResponse,
  TripResponse,
  TripScheduleItemResponse,
} from "./dto/trip.response.js";
import { TripStatus } from "./trip.constants.js";

const SUMMARY = `t.id, t.route_id AS "routeId", t.direction, t.departure_at AS "departureAt",
  t.arrival_at AS "arrivalAt", t.booking_closes_at AS "bookingClosesAt",
  t.cancellation_closes_at AS "cancellationClosesAt", t.capacity, t.status`;
const FULL = `${SUMMARY}, t.vehicle_id AS "vehicleId", t.driver_id AS "driverId", t.created_at AS "createdAt",
  t.updated_at AS "updatedAt", t.cancel_reason AS "cancelReason", t.cancelled_at AS "cancelledAt",
  t.started_at AS "startedAt", t.completed_at AS "completedAt", t.kind, t.group_request_id AS "groupRequestId"`;
/**
 * Stops are stored toward the university. A RETURN trip runs the same
 * stops in reverse (confirmed by the transport office).
 */
const STOPS_IN_TRAVEL_ORDER = `COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'position', s.position)
    ORDER BY CASE WHEN t.direction = 'RETURN' THEN -s.position ELSE s.position END)
  FROM route_stops s WHERE s.route_id = t.route_id AND s.retired_at IS NULL), '[]')`;
// Group trips (BL-15) are private outings: never listed or bookable publicly.
const UPCOMING = `t.kind='SCHEDULED' AND t.status='PUBLISHED' AND t.departure_at>now() AND ($1::uuid IS NULL OR t.route_id=$1)`;

@Injectable()
export class TripsRepository {
  constructor(private readonly db: Database) {}

  /** Future published trips with advisory remaining seats. */
  async listUpcoming(query: ListTripsQueryDto) {
    const routeId = query.routeId ?? null;
    const [items, count] = await Promise.all([
      this.db.query<TripListItemResponse>(
        `SELECT ${SUMMARY},
                t.capacity - (SELECT count(*)::int FROM bookings b WHERE b.trip_id=t.id AND b.status='CONFIRMED') AS "remainingSeats",
                ${STOPS_IN_TRAVEL_ORDER} AS stops
           FROM trips t WHERE ${UPCOMING} ORDER BY t.departure_at LIMIT $2 OFFSET $3`,
        [routeId, query.limit, query.offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM trips t WHERE ${UPCOMING}`,
        [routeId],
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  async hasAssignmentOverlap(
    vehicleId: string,
    driverId: string,
    departureAt: string,
    arrivalAt: string,
    tx: Queryable,
  ) {
    const result = await tx.query(
      "SELECT 1 FROM trips WHERE status <> 'CANCELLED' AND (vehicle_id=$1 OR driver_id=$2) AND departure_at<$4 AND arrival_at>$3 LIMIT 1",
      [vehicleId, driverId, departureAt, arrivalAt],
    );
    return Boolean(result.rowCount);
  }

  /** `origin` links a trip generated from a schedule template to its date. */
  async insert(
    trip: CreateTripDto,
    tx: Queryable,
    origin: { templateId: string; serviceDate: string } | null = null,
  ) {
    const { rows } = await tx.query<TripResponse>(
      `INSERT INTO trips AS t (route_id,vehicle_id,driver_id,direction,departure_at,arrival_at,booking_closes_at,cancellation_closes_at,capacity,status,template_id,service_date,route_version)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,(SELECT version FROM routes WHERE id=$1)) RETURNING ${FULL}`,
      [
        trip.routeId,
        trip.vehicleId,
        trip.driverId,
        trip.direction,
        trip.departureAt,
        trip.arrivalAt,
        trip.bookingClosesAt,
        trip.cancellationClosesAt,
        trip.capacity,
        trip.publish === false ? TripStatus.Draft : TripStatus.Published,
        origin?.templateId ?? null,
        origin?.serviceDate ?? null,
      ],
    );
    return rows[0]!;
  }

  /** Staff view: every status in a time window, with seats taken. */
  async listSchedule(query: TripScheduleQueryDto) {
    const where = `t.departure_at >= $1 AND t.departure_at < $2 AND ($3::text IS NULL OR t.status = $3)`;
    const params = [query.from, query.to, query.status ?? null];
    const [items, count] = await Promise.all([
      this.db.query<TripScheduleItemResponse>(
        `SELECT ${FULL},
                (SELECT count(*)::int FROM bookings b WHERE b.trip_id=t.id AND b.status='CONFIRMED') AS "confirmedBookings"
           FROM trips t WHERE ${where} ORDER BY t.departure_at LIMIT $4 OFFSET $5`,
        [...params, query.limit, query.offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM trips t WHERE ${where}`,
        params,
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  async findFull(id: string, tx: Queryable = this.db) {
    const { rows } = await tx.query<TripResponse>(
      `SELECT ${FULL} FROM trips t WHERE t.id=$1`,
      [id],
    );
    return rows[0];
  }

  /** Writes the new status and stamps the matching timestamp. */
  async applyTransition(
    id: string,
    to: TripStatus,
    cancel: { reason: string; actorId: string } | null,
    tx: Queryable,
  ) {
    await tx.query(
      `UPDATE trips SET status=$2::text, updated_at=now(),
              started_at   = CASE WHEN $2::text='IN_PROGRESS' THEN now() ELSE started_at END,
              completed_at = CASE WHEN $2::text='COMPLETED'   THEN now() ELSE completed_at END,
              cancelled_at = CASE WHEN $2::text='CANCELLED'   THEN now() ELSE cancelled_at END,
              cancel_reason = COALESCE($3, cancel_reason),
              cancelled_by  = COALESCE($4::uuid, cancelled_by)
        WHERE id=$1`,
      [id, to, cancel?.reason ?? null, cancel?.actorId ?? null],
    );
  }

  /** A GROUP trip: holds the bus and driver from departure to return. */
  async insertGroupTrip(
    trip: {
      requestId: string;
      vehicleId: string;
      driverId: string;
      departureAt: string;
      returnAt: string;
      capacity: number;
    },
    tx: Queryable,
  ) {
    const { rows } = await tx.query<TripResponse>(
      `INSERT INTO trips AS t (kind,group_request_id,route_id,vehicle_id,driver_id,direction,departure_at,arrival_at,
                               booking_closes_at,cancellation_closes_at,capacity,status)
       VALUES('GROUP',$1,NULL,$2,$3,'OUTBOUND',$4,$5,$4,$4,$6,'PUBLISHED') RETURNING ${FULL}`,
      [
        trip.requestId,
        trip.vehicleId,
        trip.driverId,
        trip.departureAt,
        trip.returnAt,
        trip.capacity,
      ],
    );
    return rows[0]!;
  }

  async groupTripsOf(requestId: string, tx: Queryable) {
    const { rows } = await tx.query<TripResponse>(
      `SELECT ${FULL} FROM trips t WHERE t.group_request_id=$1 ORDER BY t.created_at`,
      [requestId],
    );
    return rows;
  }

  async setCapacity(id: string, capacity: number, tx: Queryable) {
    await tx.query(
      "UPDATE trips SET capacity=$2, updated_at=now() WHERE id=$1",
      [id, capacity],
    );
  }

  /** Booking cutoff has passed (Postgres clock, like the booking checks). */
  async bookingWindowClosed(id: string, tx: Queryable) {
    const result = await tx.query(
      "SELECT 1 FROM trips WHERE id=$1 AND booking_closes_at <= clock_timestamp()",
      [id],
    );
    return Boolean(result.rowCount);
  }

  /** Serializes all seat changes on one trip. Taken after the user lock. */
  async lockForUpdate(id: string, tx: Queryable) {
    const { rows } = await tx.query<TripResponse>(
      `SELECT ${FULL} FROM trips t WHERE t.id=$1 FOR UPDATE`,
      [id],
    );
    return rows[0];
  }

  async isOpenForBooking(id: string, tx: Queryable) {
    const result = await tx.query(
      "SELECT 1 FROM trips t JOIN routes r ON r.id=t.route_id WHERE t.id=$1 AND t.status='PUBLISHED' AND r.active AND t.booking_closes_at>clock_timestamp()",
      [id],
    );
    return Boolean(result.rowCount);
  }

  async isOpenForCancellation(id: string, tx: Queryable) {
    const result = await tx.query(
      "SELECT 1 FROM trips WHERE id=$1 AND status IN ('PUBLISHED','CLOSED') AND cancellation_closes_at>clock_timestamp()",
      [id],
    );
    return Boolean(result.rowCount);
  }
}
