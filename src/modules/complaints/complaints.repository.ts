import { Injectable } from "@nestjs/common";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { ComplaintStatus } from "./complaint-status.js";
import {
  ComplaintMessageResponse,
  ComplaintStaffItemResponse,
  CreateComplaintDto,
  ListComplaintsQueryDto,
} from "./dto/complaint.dto.js";

const ITEM = `c.id, c.reference, c.kind, c.subject, c.status, c.trip_id AS "tripId",
  c.subscription_id AS "subscriptionId", c.created_at AS "createdAt", c.updated_at AS "updatedAt",
  c.resolved_at AS "resolvedAt", c.user_id AS "userId", u.name AS "authorName", u.email AS "authorEmail",
  u.phone AS "authorPhone", c.assigned_to AS "assignedTo"`;
const FROM = "complaints c JOIN users u ON u.id = c.user_id";

@Injectable()
export class ComplaintsRepository {
  constructor(private readonly db: Database) {}

  async filedSince24h(userId: string, tx: Queryable) {
    const { rows } = await tx.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM complaints WHERE user_id=$1 AND created_at > now() - interval '24 hours'",
      [userId],
    );
    return rows[0]!.n;
  }

  async ownsTrip(userId: string, tripId: string, tx: Queryable) {
    const r = await tx.query(
      "SELECT 1 FROM bookings WHERE user_id=$1 AND trip_id=$2 LIMIT 1",
      [userId, tripId],
    );
    return Boolean(r.rowCount);
  }

  async ownsSubscription(
    userId: string,
    subscriptionId: string,
    tx: Queryable,
  ) {
    const r = await tx.query(
      "SELECT 1 FROM subscriptions WHERE user_id=$1 AND id=$2",
      [userId, subscriptionId],
    );
    return Boolean(r.rowCount);
  }

  async insert(userId: string, dto: CreateComplaintDto, tx: Queryable) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO complaints(reference,user_id,kind,subject,trip_id,subscription_id)
       VALUES('C-' || to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY') || '-' || lpad(nextval('complaint_reference_seq')::text, 6, '0'),
              $1,$2,$3,$4,$5) RETURNING id`,
      [
        userId,
        dto.kind,
        dto.subject,
        dto.tripId ?? null,
        dto.subscriptionId ?? null,
      ],
    );
    return rows[0]!.id;
  }

  async addMessage(
    complaintId: string,
    authorId: string,
    fromStaff: boolean,
    body: string,
    internal: boolean,
    tx: Queryable,
  ) {
    await tx.query(
      "INSERT INTO complaint_messages(complaint_id,author_id,from_staff,internal,body) VALUES($1,$2,$3,$4,$5)",
      [complaintId, authorId, fromStaff, internal, body],
    );
    await tx.query("UPDATE complaints SET updated_at=now() WHERE id=$1", [
      complaintId,
    ]);
  }

  async lock(id: string, tx: Queryable) {
    const { rows } = await tx.query<ComplaintStaffItemResponse>(
      `SELECT ${ITEM} FROM ${FROM} WHERE c.id=$1 FOR UPDATE OF c`,
      [id],
    );
    return rows[0];
  }

  async find(id: string, tx: Queryable = this.db) {
    const { rows } = await tx.query<ComplaintStaffItemResponse>(
      `SELECT ${ITEM} FROM ${FROM} WHERE c.id=$1`,
      [id],
    );
    return rows[0];
  }

  async setStatus(id: string, status: ComplaintStatus, tx: Queryable) {
    await tx.query(
      `UPDATE complaints SET status=$2::text, updated_at=now(),
              resolved_at = CASE WHEN $2::text='RESOLVED' THEN now() ELSE resolved_at END,
              closed_at   = CASE WHEN $2::text='CLOSED' THEN now() ELSE closed_at END
        WHERE id=$1`,
      [id, status],
    );
  }

  async assign(id: string, assigneeId: string, tx: Queryable) {
    await tx.query(
      "UPDATE complaints SET assigned_to=$2, updated_at=now() WHERE id=$1",
      [id, assigneeId],
    );
  }

  /** Staff names are shown; the author's own messages carry no name. */
  async messages(
    id: string,
    includeInternal: boolean,
    tx: Queryable = this.db,
  ) {
    const { rows } = await tx.query<ComplaintMessageResponse>(
      `SELECT m.id, m.from_staff AS "fromStaff", CASE WHEN m.from_staff THEN u.name END AS "authorName",
              m.internal, m.body, m.created_at AS "createdAt"
         FROM complaint_messages m JOIN users u ON u.id = m.author_id
        WHERE m.complaint_id=$1 AND ($2::boolean OR NOT m.internal) ORDER BY m.created_at`,
      [id, includeInternal],
    );
    return rows;
  }

  async listByUser(userId: string, page: PaginationQueryDto) {
    const [items, count] = await Promise.all([
      this.db.query<ComplaintStaffItemResponse>(
        `SELECT ${ITEM} FROM ${FROM} WHERE c.user_id=$1 ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`,
        [userId, page.limit, page.offset],
      ),
      this.db.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM complaints WHERE user_id=$1",
        [userId],
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  async listForStaff(q: ListComplaintsQueryDto) {
    const where = `($1::text IS NULL OR c.status=$1) AND ($2::text IS NULL OR c.kind=$2)
      AND ($3::uuid IS NULL OR c.assigned_to=$3)`;
    const params = [q.status ?? null, q.kind ?? null, q.assignedTo ?? null];
    const [items, count] = await Promise.all([
      this.db.query<ComplaintStaffItemResponse>(
        `SELECT ${ITEM} FROM ${FROM} WHERE ${where}
          ORDER BY CASE c.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END, c.created_at
          LIMIT $4 OFFSET $5`,
        [...params, q.limit, q.offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ${FROM} WHERE ${where}`,
        params,
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  async staffRole(userId: string, tx: Queryable) {
    const { rows } = await tx.query<{ role: string; active: boolean }>(
      "SELECT role, active FROM users WHERE id=$1",
      [userId],
    );
    return rows[0];
  }
}
