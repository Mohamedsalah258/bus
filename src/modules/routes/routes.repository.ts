import { Injectable } from "@nestjs/common";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { RouteResponse, RouteStopResponse } from "./dto/route.response.js";

const DETAIL = `r.id, r.name, r.active, r.version,
  r.default_vehicle_id AS "defaultVehicleId", r.default_driver_id AS "defaultDriverId",
  COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'position', s.position) ORDER BY s.position)
              FROM route_stops s WHERE s.route_id = r.id AND s.retired_at IS NULL), '[]') AS stops,
  COALESCE((SELECT array_agg(e.category_id ORDER BY e.category_id)
              FROM route_eligible_categories e WHERE e.route_id = r.id), '{}') AS "eligibleCategoryIds"`;

@Injectable()
export class RoutesRepository {
  constructor(private readonly db: Database) {}

  async list(page: PaginationQueryDto, includeInactive = false) {
    const where = includeInactive ? "TRUE" : "r.active";
    const [items, count] = await Promise.all([
      this.db.query<RouteResponse>(
        `SELECT ${DETAIL} FROM routes r WHERE ${where} ORDER BY r.active DESC, r.name LIMIT $1 OFFSET $2`,
        [page.limit, page.offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM routes r WHERE ${where}`,
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  async update(
    id: string,
    change: { name?: string; active?: boolean },
    tx: Queryable,
  ) {
    await tx.query(
      "UPDATE routes SET name=COALESCE($2,name), active=COALESCE($3,active), updated_at=now() WHERE id=$1",
      [id, change.name ?? null, change.active ?? null],
    );
  }

  async upcomingTrips(id: string, tx: Queryable) {
    const { rows } = await tx.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM trips WHERE route_id=$1 AND status IN ('DRAFT','PUBLISHED','CLOSED') AND departure_at > now()",
      [id],
    );
    return rows[0]!.n;
  }

  async findDetail(id: string, tx: Queryable = this.db) {
    const { rows } = await tx.query<RouteResponse>(
      `SELECT ${DETAIL} FROM routes r WHERE r.id=$1`,
      [id],
    );
    return rows[0];
  }

  async lockForUpdate(id: string, tx: Queryable) {
    const result = await tx.query(
      "SELECT id FROM routes WHERE id=$1 FOR UPDATE",
      [id],
    );
    return Boolean(result.rowCount);
  }

  async insertRoute(name: string, tx: Queryable) {
    const { rows } = await tx.query<{ id: string }>(
      "INSERT INTO routes(name) VALUES($1) RETURNING id",
      [name],
    );
    return rows[0]!;
  }

  async insertStop(
    routeId: string,
    name: string,
    position: number,
    tx: Queryable,
  ) {
    const { rows } = await tx.query<RouteStopResponse>(
      "INSERT INTO route_stops(route_id,name,position) VALUES($1,$2,$3) RETURNING id, name, position",
      [routeId, name, position],
    );
    return rows[0]!;
  }

  async replaceEligibility(
    routeId: string,
    categoryIds: readonly string[],
    tx: Queryable,
  ) {
    await tx.query("DELETE FROM route_eligible_categories WHERE route_id=$1", [
      routeId,
    ]);
    await tx.query(
      "INSERT INTO route_eligible_categories(route_id,category_id) SELECT $1, unnest($2::uuid[])",
      [routeId, [...new Set(categoryIds)]],
    );
  }

  async setDefaults(
    id: string,
    vehicleId: string | null,
    driverId: string | null,
    tx: Queryable,
  ) {
    await tx.query(
      "UPDATE routes SET default_vehicle_id=$2, default_driver_id=$3, updated_at=now() WHERE id=$1",
      [id, vehicleId, driverId],
    );
  }

  /** Both optional ids, when given, point at active resources. */
  async defaultsAreActive(
    vehicleId: string | null,
    driverId: string | null,
    tx: Queryable,
  ) {
    const { rows } = await tx.query<{ ok: boolean }>(
      `SELECT ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM vehicles WHERE id=$1 AND active))
          AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM drivers WHERE id=$2 AND active)) AS ok`,
      [vehicleId, driverId],
    );
    return rows[0]!.ok;
  }

  async isActive(routeId: string, tx: Queryable = this.db) {
    const result = await tx.query(
      "SELECT 1 FROM routes WHERE id=$1 AND active",
      [routeId],
    );
    return Boolean(result.rowCount);
  }

  async hasStop(routeId: string, stopId: string, tx: Queryable = this.db) {
    const result = await tx.query(
      "SELECT 1 FROM route_stops WHERE id=$1 AND route_id=$2 AND retired_at IS NULL",
      [stopId, routeId],
    );
    return Boolean(result.rowCount);
  }

  async activeStops(routeId: string, tx: Queryable) {
    const { rows } = await tx.query<RouteStopResponse>(
      "SELECT id, name, position FROM route_stops WHERE route_id=$1 AND retired_at IS NULL ORDER BY position",
      [routeId],
    );
    return rows;
  }

  /** Confirmed bookings on trips not yet finished that board at these stops. */
  async upcomingBookingsAt(stopIds: readonly string[], tx: Queryable) {
    if (!stopIds.length) return 0;
    const { rows } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bookings b JOIN trips t ON t.id = b.trip_id
        WHERE b.boarding_stop_id = ANY($1::uuid[]) AND b.status = 'CONFIRMED'
          AND t.status IN ('DRAFT','PUBLISHED','CLOSED','IN_PROGRESS')`,
      [stopIds],
    );
    return rows[0]!.n;
  }

  /**
   * Applies a new stop list: retires removed stops, moves kept ones, inserts
   * new ones, bumps the version. Positions are parked first so the
   * "one active stop per position" index never trips mid-update.
   */
  async replaceStops(
    routeId: string,
    retire: readonly string[],
    plan: ReadonlyArray<{ id?: string; name: string }>,
    tx: Queryable,
  ) {
    if (retire.length)
      await tx.query(
        "UPDATE route_stops SET retired_at=now() WHERE id = ANY($1::uuid[])",
        [retire],
      );
    await tx.query(
      "UPDATE route_stops SET position = position + 10000 WHERE route_id=$1 AND retired_at IS NULL",
      [routeId],
    );
    for (const [position, stop] of plan.entries()) {
      if (stop.id)
        await tx.query("UPDATE route_stops SET position=$2 WHERE id=$1", [
          stop.id,
          position,
        ]);
      else
        await tx.query(
          "INSERT INTO route_stops(route_id,name,position) VALUES($1,$2,$3)",
          [routeId, stop.name, position],
        );
    }
    await tx.query(
      "UPDATE routes SET version = version + 1, updated_at=now() WHERE id=$1",
      [routeId],
    );
  }
}
