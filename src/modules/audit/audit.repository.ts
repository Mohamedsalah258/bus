import { Injectable } from "@nestjs/common";
import { ListAuditQueryDto } from "./dto/list-audit-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { AuditAction } from "./audit-action.js";
import { AuditEventResponse } from "./dto/audit-event.response.js";

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  entityId: string;
  /** Never include tokens, credentials, national IDs or raw SQL errors. */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly db: Database) {}

  async insert(entry: AuditEntry, tx: Queryable) {
    await tx.query(
      "INSERT INTO audit_events(actor_id,action,entity_id,metadata) VALUES($1,$2,$3,$4)",
      [
        entry.actorId,
        entry.action,
        entry.entityId,
        JSON.stringify(entry.metadata ?? {}),
      ],
    );
  }

  /** BL-21: filter by action, record, actor and Cairo date range. */
  async list(q: ListAuditQueryDto) {
    const where = `($1::text IS NULL OR action=$1) AND ($2::uuid IS NULL OR entity_id=$2)
      AND ($3::uuid IS NULL OR actor_id=$3)
      AND ($4::date IS NULL OR (created_at AT TIME ZONE 'Africa/Cairo')::date >= $4)
      AND ($5::date IS NULL OR (created_at AT TIME ZONE 'Africa/Cairo')::date <= $5)`;
    const params = [
      q.action ?? null,
      q.entityId ?? null,
      q.actorId ?? null,
      q.from ?? null,
      q.to ?? null,
    ];
    const [items, count] = await Promise.all([
      this.db.query<AuditEventResponse>(
        `SELECT id, actor_id AS "actorId", action, entity_id AS "entityId", metadata, created_at AS "createdAt"
           FROM audit_events WHERE ${where} ORDER BY created_at DESC LIMIT $6 OFFSET $7`,
        [...params, q.limit, q.offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM audit_events WHERE ${where}`,
        params,
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }
}
