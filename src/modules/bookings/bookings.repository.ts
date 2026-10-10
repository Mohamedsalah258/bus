import { Injectable } from "@nestjs/common";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { BookingFacts } from "../notifications/notification-template.js";
import { BookingResponse, MyBookingResponse } from "./dto/booking.response.js";

const COLUMNS = `b.id, b.user_id AS "userId", b.trip_id AS "tripId", b.boarding_stop_id AS "boardingStopId",
  b.status, b.idempotency_key AS "idempotencyKey", b.created_at AS "createdAt", b.cancelled_at AS "cancelledAt",
  b.cancel_reason AS "cancelReason", b.pair_id AS "pairId"`;

/** Booking plus what a passenger email needs. */
export interface BookingWithFacts extends BookingFacts {
  bookingId: string;
  userId: string;
  email: string;
}

const FACTS = `b.id AS "bookingId", b.user_id AS "userId", u.email, u.name,
  r.name AS "routeName", s.name AS "boardingStopName", t.direction,
  to_char(t.departure_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "departureAt"`;
const FACTS_FROM = `bookings b JOIN users u ON u.id = b.user_id JOIN trips t ON t.id = b.trip_id
  JOIN routes r ON r.id = t.route_id JOIN route_stops s ON s.id = b.boarding_stop_id`;

/**
 * The old site showed every driver's phone publicly. Here only a passenger
 * with a confirmed booking on a trip that has not finished sees it.
 */
const DRIVER_VISIBLE = `b.status='CONFIRMED' AND t.status IN ('PUBLISHED','CLOSED','IN_PROGRESS')`;

export interface NewBooking {
  userId: string;
  tripId: string;
  boardingStopId: string;
  idempotencyKey: string;
  pairId?: string | null;
}

@Injectable()
export class BookingsRepository {
  constructor(private readonly db: Database) {}

  async findByIdempotencyKey(userId: string, key: string, tx: Queryable) {
    const { rows } = await tx.query<BookingResponse>(
      `SELECT ${COLUMNS} FROM bookings b WHERE b.user_id=$1 AND b.idempotency_key=$2`,
      [userId, key],
    );
    return rows[0];
  }

  async findOwned(id: string, userId: string, tx: Queryable) {
    const { rows } = await tx.query<BookingResponse>(
      `SELECT ${COLUMNS} FROM bookings b WHERE b.id=$1 AND b.user_id=$2`,
      [id, userId],
    );
    return rows[0];
  }

  async hasOverlappingConfirmed(
    userId: string,
    departureAt: Date,
    arrivalAt: Date,
    tx: Queryable,
  ) {
    const result = await tx.query(
      "SELECT 1 FROM bookings b JOIN trips t ON t.id=b.trip_id WHERE b.user_id=$1 AND b.status='CONFIRMED' AND t.status <> 'CANCELLED' AND t.departure_at<$3 AND t.arrival_at>$2",
      [userId, departureAt, arrivalAt],
    );
    return Boolean(result.rowCount);
  }

  /** Must run while the trip row is locked to be authoritative. */
  async countConfirmed(tripId: string, tx: Queryable) {
    const { rows } = await tx.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM bookings WHERE trip_id=$1 AND status='CONFIRMED'",
      [tripId],
    );
    return rows[0]?.count ?? 0;
  }

  async insert(booking: NewBooking, tx: Queryable) {
    const { rows } = await tx.query<BookingResponse>(
      `INSERT INTO bookings AS b (user_id,trip_id,boarding_stop_id,idempotency_key,pair_id) VALUES($1,$2,$3,$4,$5) RETURNING ${COLUMNS}`,
      [
        booking.userId,
        booking.tripId,
        booking.boardingStopId,
        booking.idempotencyKey,
        booking.pairId ?? null,
      ],
    );
    return rows[0]!;
  }

  async markCancelled(id: string, tx: Queryable) {
    const { rows } = await tx.query<BookingResponse>(
      `UPDATE bookings AS b SET status='CANCELLED',cancelled_at=now() WHERE b.id=$1 RETURNING ${COLUMNS}`,
      [id],
    );
    return rows[0]!;
  }

  async factsFor(bookingId: string, tx: Queryable) {
    const { rows } = await tx.query<BookingWithFacts>(
      `SELECT ${FACTS} FROM ${FACTS_FROM} WHERE b.id=$1`,
      [bookingId],
    );
    return rows[0]!;
  }

  /** Confirmed bookings on one trip, with email facts. */
  async confirmedOnTrip(tripId: string, tx: Queryable) {
    const { rows } = await tx.query<BookingWithFacts>(
      `SELECT ${FACTS} FROM ${FACTS_FROM} WHERE b.trip_id=$1 AND b.status='CONFIRMED' ORDER BY b.created_at`,
      [tripId],
    );
    return rows;
  }

  /**
   * Confirmed bookings of one passenger on one route whose trip has not left
   * yet and falls inside [from, until] (Cairo dates).
   */
  async upcomingConfirmedOnRoute(
    userId: string,
    routeId: string,
    from: string,
    until: string,
    tx: Queryable,
  ) {
    const { rows } = await tx.query<BookingWithFacts>(
      `SELECT ${FACTS} FROM ${FACTS_FROM}
        WHERE b.user_id=$1 AND t.route_id=$2 AND b.status='CONFIRMED'
          AND t.status IN ('PUBLISHED','CLOSED','DRAFT') AND t.departure_at > now()
          AND (t.departure_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $3::date AND $4::date
        ORDER BY t.departure_at`,
      [userId, routeId, from, until],
    );
    return rows;
  }

  async cancelByAdmin(
    ids: readonly string[],
    reason: string,
    actorId: string,
    tx: Queryable,
  ) {
    if (!ids.length) return;
    await tx.query(
      `UPDATE bookings SET status='CANCELLED_BY_ADMIN', cancelled_at=now(), cancel_reason=$2, cancelled_by=$3
        WHERE id = ANY($1::uuid[]) AND status='CONFIRMED'`,
      [ids, reason, actorId],
    );
  }

  async partnerOf(id: string, pairId: string, tx: Queryable) {
    const { rows } = await tx.query<{ id: string }>(
      "SELECT id FROM bookings WHERE pair_id=$1 AND id<>$2 AND status='CONFIRMED'",
      [pairId, id],
    );
    return rows[0]?.id;
  }

  async findById(id: string, tx: Queryable) {
    const { rows } = await tx.query<BookingResponse>(
      `SELECT ${COLUMNS} FROM bookings b WHERE b.id=$1`,
      [id],
    );
    return rows[0];
  }

  async listByUser(userId: string, page: PaginationQueryDto) {
    const [items, count] = await Promise.all([
      this.db.query<MyBookingResponse>(
        `SELECT ${COLUMNS}, t.departure_at AS "departureAt", t.arrival_at AS "arrivalAt", t.direction,
                r.name AS "routeName", s.name AS "boardingStopName",
                CASE WHEN ${DRIVER_VISIBLE} THEN d.name END AS "driverName",
                CASE WHEN ${DRIVER_VISIBLE} THEN d.phone END AS "driverPhone"
           FROM bookings b JOIN trips t ON t.id=b.trip_id JOIN routes r ON r.id=t.route_id
           JOIN route_stops s ON s.id=b.boarding_stop_id JOIN drivers d ON d.id=t.driver_id
          WHERE b.user_id=$1 ORDER BY b.created_at DESC LIMIT $2 OFFSET $3`,
        [userId, page.limit, page.offset],
      ),
      this.db.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM bookings WHERE user_id=$1",
        [userId],
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }
}
