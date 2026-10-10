import { Injectable } from "@nestjs/common";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { CreateVehicleDto } from "./dto/create-vehicle.dto.js";
import { VehicleResponse } from "./dto/vehicle.response.js";

const COLUMNS = "id, plate, capacity, active";

@Injectable()
export class VehiclesRepository {
  constructor(private readonly db: Database) {}

  async list(page: PaginationQueryDto) {
    const [items, count] = await Promise.all([
      this.db.query<VehicleResponse>(
        `SELECT ${COLUMNS} FROM vehicles ORDER BY plate LIMIT $1 OFFSET $2`,
        [page.limit, page.offset],
      ),
      this.db.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM vehicles",
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  async create(vehicle: CreateVehicleDto, tx: Queryable = this.db) {
    const { rows } = await tx.query<VehicleResponse>(
      `INSERT INTO vehicles(plate,capacity) VALUES($1,$2) RETURNING ${COLUMNS}`,
      [vehicle.plate, vehicle.capacity],
    );
    return rows[0]!;
  }

  async update(
    id: string,
    change: { plate?: string; capacity?: number; active?: boolean },
    tx: Queryable,
  ) {
    const { rows } = await tx.query<VehicleResponse>(
      `UPDATE vehicles SET plate=COALESCE($2,plate), capacity=COALESCE($3,capacity),
              active=COALESCE($4,active), updated_at=now()
        WHERE id=$1 RETURNING ${COLUMNS}`,
      [
        id,
        change.plate ?? null,
        change.capacity ?? null,
        change.active ?? null,
      ],
    );
    return rows[0]!;
  }

  /** Assignment lock order: vehicle → driver. */
  async lockForUpdate(id: string, tx: Queryable) {
    const { rows } = await tx.query<VehicleResponse>(
      `SELECT ${COLUMNS} FROM vehicles WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return rows[0];
  }
}
