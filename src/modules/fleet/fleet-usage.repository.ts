import { Injectable } from "@nestjs/common";
import { Queryable } from "../../database/database.types.js";

/** What still depends on a vehicle or driver before it can be retired. */
@Injectable()
export class FleetUsageRepository {
  async usage(kind: "vehicle" | "driver", id: string, tx: Queryable) {
    // Column names are fixed by `kind`, never user input.
    const tripColumn = kind === "vehicle" ? "vehicle_id" : "driver_id";
    const routeColumn =
      kind === "vehicle" ? "default_vehicle_id" : "default_driver_id";
    const { rows } = await tx.query<{
      upcomingTrips: number;
      routes: string[];
    }>(
      `SELECT
         (SELECT count(*)::int FROM trips
           WHERE ${tripColumn}=$1 AND status IN ('DRAFT','PUBLISHED','CLOSED','IN_PROGRESS')
             AND arrival_at > now()) AS "upcomingTrips",
         COALESCE((SELECT array_agg(name ORDER BY name) FROM routes WHERE ${routeColumn}=$1), '{}') AS routes`,
      [id],
    );
    return rows[0]!;
  }
}
