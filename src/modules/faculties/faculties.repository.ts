import { Injectable } from "@nestjs/common";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { FacultyResponse } from "./dto/faculty.response.js";

const COLUMNS = `id, name, created_at AS "createdAt"`;

@Injectable()
export class FacultiesRepository {
  constructor(private readonly db: Database) {}

  async list(page: PaginationQueryDto) {
    const [items, count] = await Promise.all([
      this.db.query<FacultyResponse>(
        `SELECT ${COLUMNS} FROM faculties ORDER BY name LIMIT $1 OFFSET $2`,
        [page.limit, page.offset],
      ),
      this.db.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM faculties",
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  async create(name: string) {
    const { rows } = await this.db.query<FacultyResponse>(
      `INSERT INTO faculties(name) VALUES($1) RETURNING ${COLUMNS}`,
      [name],
    );
    return rows[0]!;
  }

  async rename(id: string, name: string, tx: Queryable) {
    const { rows } = await tx.query<FacultyResponse>(
      `UPDATE faculties SET name=$2 WHERE id=$1 RETURNING ${COLUMNS}`,
      [id, name],
    );
    return rows[0];
  }
}
