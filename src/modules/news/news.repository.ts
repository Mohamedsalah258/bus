import { Injectable } from "@nestjs/common";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import {
  CreateNewsDto,
  ListNewsQueryDto,
  NewsResponse,
  UpdateNewsDto,
} from "./dto/news.dto.js";

const COLUMNS = `id, kind, title, body, route_id AS "routeId", pinned, published_at AS "publishedAt",
  expires_at AS "expiresAt", active`;
const VISIBLE =
  "active AND published_at <= now() AND (expires_at IS NULL OR expires_at > now())";

@Injectable()
export class NewsRepository {
  constructor(private readonly db: Database) {}

  async list(q: ListNewsQueryDto, includeHidden: boolean) {
    const where = `(${includeHidden ? "TRUE" : VISIBLE}) AND ($1::text IS NULL OR kind=$1)
      AND ($2::uuid IS NULL OR route_id=$2 OR route_id IS NULL)`;
    const params = [q.kind ?? null, q.routeId ?? null];
    const [items, count] = await Promise.all([
      this.db.query<NewsResponse>(
        `SELECT ${COLUMNS} FROM news_posts WHERE ${where} ORDER BY pinned DESC, published_at DESC LIMIT $3 OFFSET $4`,
        [...params, q.limit, q.offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM news_posts WHERE ${where}`,
        params,
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  async findVisible(id: string) {
    const { rows } = await this.db.query<NewsResponse>(
      `SELECT ${COLUMNS} FROM news_posts WHERE id=$1 AND ${VISIBLE}`,
      [id],
    );
    return rows[0];
  }

  async create(dto: CreateNewsDto, actorId: string, tx: Queryable) {
    const { rows } = await tx.query<NewsResponse>(
      `INSERT INTO news_posts(kind,title,body,route_id,pinned,published_at,expires_at,created_by)
       VALUES($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()),$7,$8) RETURNING ${COLUMNS}`,
      [
        dto.kind,
        dto.title,
        dto.body,
        dto.routeId ?? null,
        dto.pinned ?? false,
        dto.publishedAt ?? null,
        dto.expiresAt ?? null,
        actorId,
      ],
    );
    return rows[0]!;
  }

  async update(id: string, dto: UpdateNewsDto, tx: Queryable) {
    const { rows } = await tx.query<NewsResponse>(
      `UPDATE news_posts SET kind=COALESCE($2,kind), title=COALESCE($3,title), body=COALESCE($4,body),
              route_id=CASE WHEN $5::boolean THEN $6 ELSE route_id END, pinned=COALESCE($7,pinned),
              published_at=COALESCE($8,published_at), expires_at=CASE WHEN $9::boolean THEN $10 ELSE expires_at END,
              active=COALESCE($11,active), updated_at=now()
        WHERE id=$1 RETURNING ${COLUMNS}`,
      [
        id,
        dto.kind ?? null,
        dto.title ?? null,
        dto.body ?? null,
        dto.routeId !== undefined,
        dto.routeId ?? null,
        dto.pinned ?? null,
        dto.publishedAt ?? null,
        dto.expiresAt !== undefined,
        dto.expiresAt ?? null,
        dto.active ?? null,
      ],
    );
    return rows[0];
  }
}
