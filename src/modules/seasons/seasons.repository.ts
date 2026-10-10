import { Injectable } from "@nestjs/common";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { CreateSeasonDto } from "./dto/create-season.dto.js";
import { SeasonResponse } from "./dto/season.response.js";

// ::text keeps calendar dates as YYYY-MM-DD; a JS Date would shift by time zone.
const COLUMNS = `id, name, starts_on::text AS "startsOn", ends_on::text AS "endsOn"`;

@Injectable()
export class SeasonsRepository {
  constructor(private readonly db: Database) {}

  async list(page: PaginationQueryDto) {
    const [items, count] = await Promise.all([
      this.db.query<SeasonResponse>(
        `SELECT ${COLUMNS} FROM seasons ORDER BY starts_on DESC LIMIT $1 OFFSET $2`,
        [page.limit, page.offset],
      ),
      this.db.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM seasons",
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  async create(season: CreateSeasonDto) {
    const { rows } = await this.db.query<SeasonResponse>(
      `INSERT INTO seasons(name,starts_on,ends_on) VALUES($1,$2,$3) RETURNING ${COLUMNS}`,
      [season.name, season.startsOn, season.endsOn],
    );
    return rows[0]!;
  }

  async lock(id: string, tx: Queryable) {
    const { rows } = await tx.query<SeasonResponse>(
      `SELECT ${COLUMNS} FROM seasons WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return rows[0];
  }

  /** Plans that would fall outside the new dates. */
  async plansOutside(
    id: string,
    startsOn: string,
    endsOn: string,
    tx: Queryable,
  ) {
    const { rows } = await tx.query<{ name: string }>(
      "SELECT name FROM subscription_plans WHERE season_id=$1 AND (starts_on < $2::date OR ends_on > $3::date) ORDER BY name",
      [id, startsOn, endsOn],
    );
    return rows.map((r) => r.name);
  }

  async update(
    id: string,
    s: { name: string; startsOn: string; endsOn: string },
    tx: Queryable,
  ) {
    const { rows } = await tx.query<SeasonResponse>(
      `UPDATE seasons SET name=$2, starts_on=$3, ends_on=$4 WHERE id=$1 RETURNING ${COLUMNS}`,
      [id, s.name, s.startsOn, s.endsOn],
    );
    return rows[0]!;
  }
}
