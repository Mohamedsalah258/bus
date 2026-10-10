import { Injectable } from "@nestjs/common";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import {
  CreateScheduleDto,
  ServiceExceptionResponse,
} from "./dto/schedule.dto.js";
import { toDow } from "./weekdays.js";

export interface ScheduleRow {
  id: string;
  routeId: string;
  name: string;
  direction: "OUTBOUND" | "RETURN";
  departureTime: string;
  durationMinutes: number;
  weekdays: number[];
  validFrom: string;
  validUntil: string;
  vehicleId: string | null;
  driverId: string | null;
  capacity: number | null;
  bookingCloseMinutes: number;
  cancellationCloseMinutes: number;
  active: boolean;
}

export interface Occurrence {
  serviceDate: string;
  departureAt: string;
  arrivalAt: string;
  bookingClosesAt: string;
  cancellationClosesAt: string;
  holiday: boolean;
  existing: boolean;
  past: boolean;
}

const COLUMNS = `id, route_id AS "routeId", name, direction, to_char(departure_time,'HH24:MI') AS "departureTime",
  duration_minutes AS "durationMinutes", weekdays::int[] AS weekdays, valid_from::text AS "validFrom",
  valid_until::text AS "validUntil", vehicle_id AS "vehicleId", driver_id AS "driverId", capacity,
  booking_close_minutes AS "bookingCloseMinutes", cancellation_close_minutes AS "cancellationCloseMinutes", active`;
const ISO = (expr: string) =>
  // Parentheses matter: AT TIME ZONE binds tighter than + and -.
  `to_char((${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

@Injectable()
export class SchedulesRepository {
  constructor(private readonly db: Database) {}

  async list(routeId: string | null) {
    const { rows } = await this.db.query<ScheduleRow>(
      `SELECT ${COLUMNS} FROM schedule_templates WHERE ($1::uuid IS NULL OR route_id=$1)
        ORDER BY route_id, direction, departure_time`,
      [routeId],
    );
    return rows;
  }

  async create(dto: CreateScheduleDto, tx: Queryable) {
    const { rows } = await tx.query<ScheduleRow>(
      `INSERT INTO schedule_templates(route_id,name,direction,departure_time,duration_minutes,weekdays,
         valid_from,valid_until,vehicle_id,driver_id,capacity,booking_close_minutes,cancellation_close_minutes)
       VALUES($1,$2,$3,$4,$5,$6::smallint[],$7,$8,$9,$10,$11,$12,$13) RETURNING ${COLUMNS}`,
      [
        dto.routeId,
        dto.name,
        dto.direction,
        dto.departureTime,
        dto.durationMinutes,
        toDow(dto.weekdays),
        dto.validFrom,
        dto.validUntil,
        dto.vehicleId ?? null,
        dto.driverId ?? null,
        dto.capacity ?? null,
        dto.bookingCloseMinutes,
        dto.cancellationCloseMinutes,
      ],
    );
    return rows[0]!;
  }

  async lock(id: string, tx: Queryable) {
    const { rows } = await tx.query<ScheduleRow>(
      `SELECT ${COLUMNS} FROM schedule_templates WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return rows[0];
  }

  async replace(id: string, s: Omit<ScheduleRow, "id">, tx: Queryable) {
    const { rows } = await tx.query<ScheduleRow>(
      `UPDATE schedule_templates SET route_id=$2,name=$3,direction=$4,departure_time=$5,duration_minutes=$6,
         weekdays=$7::smallint[],valid_from=$8,valid_until=$9,vehicle_id=$10,driver_id=$11,capacity=$12,
         booking_close_minutes=$13,cancellation_close_minutes=$14,active=$15,updated_at=now()
       WHERE id=$1 RETURNING ${COLUMNS}`,
      [
        id,
        s.routeId,
        s.name,
        s.direction,
        s.departureTime,
        s.durationMinutes,
        s.weekdays,
        s.validFrom,
        s.validUntil,
        s.vehicleId,
        s.driverId,
        s.capacity,
        s.bookingCloseMinutes,
        s.cancellationCloseMinutes,
        s.active,
      ],
    );
    return rows[0]!;
  }

  /**
   * Every date in [from, to] ∩ validity on the template's weekdays, with
   * Cairo wall-clock converted to instants (DST-safe) and skip reasons.
   */
  async occurrences(s: ScheduleRow, from: string, to: string, tx: Queryable) {
    const { rows } = await tx.query<Occurrence>(
      `WITH days AS (
         SELECT g::date AS svc_date
           FROM generate_series(GREATEST($1::date,$3::date)::timestamp, LEAST($2::date,$4::date)::timestamp, interval '1 day') AS g
          WHERE EXTRACT(DOW FROM g)::int = ANY($5::int[])),
       times AS (
         SELECT svc_date, ((svc_date + $6::time)::timestamp AT TIME ZONE 'Africa/Cairo') AS dep FROM days)
       SELECT svc_date::text AS "serviceDate",
              ${ISO("dep")} AS "departureAt",
              ${ISO("dep + make_interval(mins => $7)")} AS "arrivalAt",
              ${ISO("dep - make_interval(mins => $8)")} AS "bookingClosesAt",
              ${ISO("dep - make_interval(mins => $9)")} AS "cancellationClosesAt",
              EXISTS (SELECT 1 FROM service_exceptions e WHERE e.service_date = svc_date) AS holiday,
              EXISTS (SELECT 1 FROM trips t WHERE t.template_id = $10 AND t.service_date = svc_date) AS existing,
              (dep - make_interval(mins => GREATEST($8, $9))) <= clock_timestamp() AS past
         FROM times ORDER BY svc_date`,
      [
        from,
        to,
        s.validFrom,
        s.validUntil,
        s.weekdays,
        s.departureTime,
        s.durationMinutes,
        s.bookingCloseMinutes,
        s.cancellationCloseMinutes,
        s.id,
      ],
    );
    return rows;
  }

  async routeDefaults(routeId: string, tx: Queryable) {
    const { rows } = await tx.query<{
      active: boolean;
      vehicleId: string | null;
      driverId: string | null;
    }>(
      `SELECT active, default_vehicle_id AS "vehicleId", default_driver_id AS "driverId" FROM routes WHERE id=$1`,
      [routeId],
    );
    return rows[0];
  }

  // ---- service exceptions ----

  async addException(date: string, reason: string, tx: Queryable) {
    const { rows } = await tx.query<ServiceExceptionResponse>(
      `INSERT INTO service_exceptions(service_date,reason) VALUES($1,$2)
       ON CONFLICT (service_date) DO UPDATE SET reason=EXCLUDED.reason
       RETURNING id, service_date::text AS date, reason,
         (SELECT count(*)::int FROM trips t WHERE (t.departure_at AT TIME ZONE 'Africa/Cairo')::date = $1::date
            AND t.status IN ('DRAFT','PUBLISHED','CLOSED')) AS "tripsThatDay"`,
      [date, reason],
    );
    return rows[0]!;
  }

  async listExceptions(from: string, to: string) {
    const { rows } = await this.db.query<ServiceExceptionResponse>(
      `SELECT id, service_date::text AS date, reason,
         (SELECT count(*)::int FROM trips t WHERE (t.departure_at AT TIME ZONE 'Africa/Cairo')::date = e.service_date
            AND t.status IN ('DRAFT','PUBLISHED','CLOSED')) AS "tripsThatDay"
         FROM service_exceptions e WHERE service_date BETWEEN $1 AND $2 ORDER BY service_date`,
      [from, to],
    );
    return rows;
  }

  async removeException(id: string, tx: Queryable) {
    const result = await tx.query(
      "DELETE FROM service_exceptions WHERE id=$1",
      [id],
    );
    return result.rowCount === 1;
  }
}
