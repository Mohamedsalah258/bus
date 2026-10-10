import { Injectable } from "@nestjs/common";
import { Database } from "../../database/database.service.js";
import {
  CountRow,
  DailyBookingsRow,
  FacultyBookingsRow,
  RouteOccupancyRow,
} from "./dto/report.dto.js";

/** Travel date of a trip in Cairo; every report uses Cairo calendar days. */
const CAIRO_DAY = "(t.departure_at AT TIME ZONE 'Africa/Cairo')::date";
/** Trips that actually offered seats (not drafts, not cancelled), public only. */
const COUNTED_TRIP =
  "t.kind = 'SCHEDULED' AND t.status IN ('PUBLISHED','CLOSED','IN_PROGRESS','COMPLETED')";

@Injectable()
export class ReportsRepository {
  constructor(private readonly db: Database) {}

  async dailyBookings(from: string, to: string) {
    const { rows } = await this.db.query<DailyBookingsRow>(
      `WITH days AS (
         SELECT g::date AS svc_date FROM generate_series($1::date::timestamp, $2::date::timestamp, interval '1 day') g),
       per_trip AS (
         SELECT ${CAIRO_DAY} AS svc_date, t.capacity,
                count(b.*) FILTER (WHERE b.status='CONFIRMED') AS confirmed,
                count(b.*) FILTER (WHERE b.status='CANCELLED') AS by_passenger,
                count(b.*) FILTER (WHERE b.status='CANCELLED_BY_ADMIN') AS by_admin
           FROM trips t LEFT JOIN bookings b ON b.trip_id = t.id
          WHERE ${COUNTED_TRIP} AND ${CAIRO_DAY} BETWEEN $1 AND $2
          GROUP BY t.id)
       SELECT d.svc_date::text AS date, count(p.*)::int AS trips, COALESCE(sum(p.capacity),0)::int AS seats,
              COALESCE(sum(p.confirmed),0)::int AS confirmed,
              COALESCE(sum(p.by_passenger),0)::int AS "cancelledByPassenger",
              COALESCE(sum(p.by_admin),0)::int AS "cancelledByAdmin"
         FROM days d LEFT JOIN per_trip p ON p.svc_date = d.svc_date
        GROUP BY d.svc_date ORDER BY d.svc_date`,
      [from, to],
    );
    return rows;
  }

  async occupancyByRoute(from: string, to: string) {
    const { rows } = await this.db.query<RouteOccupancyRow>(
      `WITH per_trip AS (
         SELECT t.route_id, t.capacity, count(b.*) FILTER (WHERE b.status='CONFIRMED') AS confirmed
           FROM trips t LEFT JOIN bookings b ON b.trip_id = t.id
          WHERE ${COUNTED_TRIP} AND ${CAIRO_DAY} BETWEEN $1 AND $2
          GROUP BY t.id)
       SELECT r.id AS "routeId", r.name AS "routeName", count(*)::int AS trips, sum(p.capacity)::int AS seats,
              sum(p.confirmed)::int AS confirmed,
              COALESCE(round(100.0 * sum(p.confirmed) / NULLIF(sum(p.capacity), 0), 1), 0)::float AS "occupancyPercent"
         FROM per_trip p JOIN routes r ON r.id = p.route_id
        GROUP BY r.id, r.name ORDER BY r.name`,
      [from, to],
    );
    return rows;
  }

  async bookingsByFaculty(from: string, to: string) {
    const { rows } = await this.db.query<FacultyBookingsRow>(
      `SELECT f.id AS "facultyId", COALESCE(f.name, 'غير محدد') AS "facultyName",
              count(*)::int AS confirmed, count(DISTINCT b.user_id)::int AS passengers
         FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN users u ON u.id = b.user_id
         LEFT JOIN faculties f ON f.id = u.faculty_id
        WHERE b.status = 'CONFIRMED' AND ${COUNTED_TRIP} AND ${CAIRO_DAY} BETWEEN $1 AND $2
        GROUP BY f.id, f.name ORDER BY confirmed DESC, "facultyName"`,
      [from, to],
    );
    return rows;
  }

  async subscriptions(from: string, to: string) {
    const created =
      "(s.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1 AND $2";
    const [byStatus, reasons, avg, pending] = await Promise.all([
      this.db.query<CountRow>(
        `SELECT s.status AS key, count(*)::int AS count FROM subscriptions s WHERE ${created} GROUP BY s.status ORDER BY count DESC`,
        [from, to],
      ),
      this.db.query<CountRow>(
        `SELECT s.review_reason AS key, count(*)::int AS count FROM subscriptions s
          WHERE ${created} AND s.status='REJECTED' GROUP BY s.review_reason ORDER BY count DESC LIMIT 20`,
        [from, to],
      ),
      this.db.query<{ hours: number | null }>(
        `SELECT round(avg(EXTRACT(EPOCH FROM s.reviewed_at - s.created_at)) / 3600.0, 1)::float AS hours
           FROM subscriptions s WHERE ${created} AND s.reviewed_at IS NOT NULL`,
        [from, to],
      ),
      this.db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM subscriptions WHERE status='PENDING'",
      ),
    ]);
    return {
      byStatus: byStatus.rows,
      rejectionReasons: reasons.rows,
      averageDecisionHours: avg.rows[0]!.hours,
      pendingNow: pending.rows[0]!.n,
    };
  }

  async complaints(from: string, to: string) {
    const created =
      "(c.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1 AND $2";
    const [byStatus, byKind, avg] = await Promise.all([
      this.db.query<CountRow>(
        `SELECT c.status AS key, count(*)::int AS count FROM complaints c WHERE ${created} GROUP BY c.status ORDER BY count DESC`,
        [from, to],
      ),
      this.db.query<CountRow>(
        `SELECT c.kind AS key, count(*)::int AS count FROM complaints c WHERE ${created} GROUP BY c.kind ORDER BY count DESC`,
        [from, to],
      ),
      this.db.query<{ hours: number | null }>(
        `SELECT round(avg(EXTRACT(EPOCH FROM c.resolved_at - c.created_at)) / 3600.0, 1)::float AS hours
           FROM complaints c WHERE ${created} AND c.resolved_at IS NOT NULL`,
        [from, to],
      ),
    ]);
    return {
      byStatus: byStatus.rows,
      byKind: byKind.rows,
      averageResolutionHours: avg.rows[0]!.hours,
    };
  }
}
