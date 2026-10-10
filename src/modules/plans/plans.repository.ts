import { Injectable } from "@nestjs/common";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import {
  CreatePlanDto,
  ListPlansQueryDto,
  PlanResponse,
} from "./dto/plan.dto.js";

const COLUMNS = `id, season_id AS "seasonId", name, period, starts_on::text AS "startsOn",
  ends_on::text AS "endsOn", fee_minor AS "feeMinor", currency, active`;
/** Active, and not over yet in Cairo. */
const OPEN = `active AND ends_on >= (clock_timestamp() AT TIME ZONE 'Africa/Cairo')::date`;

@Injectable()
export class PlansRepository {
  constructor(private readonly db: Database) {}

  async listOpen(query: ListPlansQueryDto) {
    const where = `${OPEN} AND ($1::uuid IS NULL OR season_id=$1)`;
    const params = [query.seasonId ?? null];
    const [items, count] = await Promise.all([
      this.db.query<PlanResponse>(
        `SELECT ${COLUMNS} FROM subscription_plans WHERE ${where} ORDER BY starts_on, name LIMIT $2 OFFSET $3`,
        [...params, query.limit, query.offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM subscription_plans WHERE ${where}`,
        params,
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  /** Plan dates fall inside the season's dates. */
  async fitsSeason(dto: CreatePlanDto, tx: Queryable) {
    const result = await tx.query(
      "SELECT 1 FROM seasons WHERE id=$1 AND starts_on <= $2::date AND ends_on >= $3::date",
      [dto.seasonId, dto.startsOn, dto.endsOn],
    );
    return Boolean(result.rowCount);
  }

  async create(dto: CreatePlanDto, tx: Queryable) {
    const { rows } = await tx.query<PlanResponse>(
      `INSERT INTO subscription_plans(season_id,name,period,starts_on,ends_on,fee_minor)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING ${COLUMNS}`,
      [
        dto.seasonId,
        dto.name,
        dto.period,
        dto.startsOn,
        dto.endsOn,
        dto.feeMinor,
      ],
    );
    return rows[0]!;
  }

  async setActive(id: string, active: boolean, tx: Queryable) {
    const { rows } = await tx.query<PlanResponse>(
      `UPDATE subscription_plans SET active=$2 WHERE id=$1 RETURNING ${COLUMNS}`,
      [id, active],
    );
    return rows[0];
  }

  /** Open plan for a new request, locked against concurrent deactivation. */
  async lockOpen(id: string, tx: Queryable) {
    const { rows } = await tx.query<PlanResponse>(
      `SELECT ${COLUMNS} FROM subscription_plans WHERE id=$1 AND ${OPEN} FOR SHARE`,
      [id],
    );
    return rows[0];
  }
}
