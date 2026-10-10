import { Injectable } from "@nestjs/common";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { DriverResponse } from "./dto/driver.response.js";

const COLUMNS = "id, name, phone, active";

@Injectable()
export class DriversRepository {
  constructor(private readonly db: Database) {}

  async list(page: PaginationQueryDto) {
    const [items, count] = await Promise.all([
      this.db.query<DriverResponse>(
        `SELECT ${COLUMNS} FROM drivers ORDER BY name LIMIT $1 OFFSET $2`,
        [page.limit, page.offset],
      ),
      this.db.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM drivers",
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  async create(name: string, phone: string | null, tx: Queryable = this.db) {
    const { rows } = await tx.query<DriverResponse>(
      `INSERT INTO drivers(name, phone) VALUES($1, $2) RETURNING ${COLUMNS}`,
      [name, phone],
    );
    return rows[0]!;
  }

  async update(
    id: string,
    change: { name?: string; phone?: string; active?: boolean },
    tx: Queryable,
  ) {
    const { rows } = await tx.query<DriverResponse>(
      `UPDATE drivers SET name=COALESCE($2,name), phone=COALESCE($3,phone),
              active=COALESCE($4,active), updated_at=now()
        WHERE id=$1 RETURNING ${COLUMNS}`,
      [id, change.name ?? null, change.phone ?? null, change.active ?? null],
    );
    return rows[0]!;
  }

  /** Assignment lock order: vehicle → driver. */
  async lockForUpdate(id: string, tx: Queryable) {
    const { rows } = await tx.query<DriverResponse>(
      `SELECT ${COLUMNS} FROM drivers WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return rows[0];
  }
}
