import { Injectable } from "@nestjs/common";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import {
  CategoryResponse,
  CreateCategoryDto,
  UpdateCategoryDto,
} from "./dto/category.dto.js";

const COLUMNS = "id, code, name, active";

@Injectable()
export class CategoriesRepository {
  constructor(private readonly db: Database) {}

  async listActive(page: PaginationQueryDto) {
    const [items, count] = await Promise.all([
      this.db.query<CategoryResponse>(
        `SELECT ${COLUMNS} FROM beneficiary_categories WHERE active ORDER BY name LIMIT $1 OFFSET $2`,
        [page.limit, page.offset],
      ),
      this.db.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM beneficiary_categories WHERE active",
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  async create(dto: CreateCategoryDto, tx: Queryable) {
    const { rows } = await tx.query<CategoryResponse>(
      `INSERT INTO beneficiary_categories(code,name) VALUES($1,$2) RETURNING ${COLUMNS}`,
      [dto.code, dto.name],
    );
    return rows[0]!;
  }

  /** Every id exists and is active (duplicates count once). */
  async allActive(ids: readonly string[], tx: Queryable = this.db) {
    const unique = [...new Set(ids)];
    const { rows } = await tx.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM beneficiary_categories WHERE id = ANY($1::uuid[]) AND active",
      [unique],
    );
    return rows[0]!.count === unique.length;
  }

  async update(id: string, dto: UpdateCategoryDto, tx: Queryable) {
    const { rows } = await tx.query<CategoryResponse>(
      `UPDATE beneficiary_categories SET name=COALESCE($2,name), active=COALESCE($3,active) WHERE id=$1 RETURNING ${COLUMNS}`,
      [id, dto.name ?? null, dto.active ?? null],
    );
    return rows[0];
  }
}
