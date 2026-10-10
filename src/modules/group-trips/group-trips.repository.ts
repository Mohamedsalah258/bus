import { Injectable } from "@nestjs/common";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import {
  CreateGroupTripDto,
  GroupTripResponse,
  ListGroupTripsQueryDto,
} from "./dto/group-trip.dto.js";
import { GroupTripStatus } from "./group-trip-status.js";

const ITEM = `g.id, g.reference, g.user_id AS "userId", u.name AS "requesterName", u.email AS "requesterEmail",
  u.phone AS "requesterPhone", u.faculty_id AS "facultyId", g.organization, g.purpose, g.destination, g.details,
  g.pickup_location AS "pickupLocation", g.passengers, g.departure_at AS "departureAt", g.return_at AS "returnAt",
  g.status, g.decision_reason AS "decisionReason", g.applicant_note AS "applicantNote", g.created_at AS "createdAt"`;
const FROM = "group_trip_requests g JOIN users u ON u.id = g.user_id";

@Injectable()
export class GroupTripsRepository {
  constructor(private readonly db: Database) {}

  async insert(userId: string, dto: CreateGroupTripDto, tx: Queryable) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO group_trip_requests(reference,user_id,organization,purpose,destination,details,pickup_location,
                                       passengers,departure_at,return_at)
       VALUES('G-' || to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY') || '-' || lpad(nextval('group_trip_reference_seq')::text,6,'0'),
              $1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        userId,
        dto.organization,
        dto.purpose,
        dto.destination,
        dto.details ?? null,
        dto.pickupLocation,
        dto.passengers,
        dto.departureAt,
        dto.returnAt,
      ],
    );
    return rows[0]!.id;
  }

  async find(id: string, tx: Queryable = this.db) {
    const { rows } = await tx.query<GroupTripResponse>(
      `SELECT ${ITEM} FROM ${FROM} WHERE g.id=$1`,
      [id],
    );
    return rows[0];
  }

  async lock(id: string, tx: Queryable) {
    const { rows } = await tx.query<GroupTripResponse>(
      `SELECT ${ITEM} FROM ${FROM} WHERE g.id=$1 FOR UPDATE OF g`,
      [id],
    );
    return rows[0];
  }

  async decide(
    id: string,
    status: GroupTripStatus,
    reason: string,
    actorId: string,
    tx: Queryable,
  ) {
    await tx.query(
      `UPDATE group_trip_requests SET status=$2, decision_reason=$3, decided_by=$4, decided_at=now(), updated_at=now()
        WHERE id=$1`,
      [id, status, reason, actorId],
    );
  }

  async requesterMove(
    id: string,
    status: GroupTripStatus,
    note: string | null,
    tx: Queryable,
  ) {
    await tx.query(
      `UPDATE group_trip_requests SET status=$2, applicant_note=COALESCE($3, applicant_note), updated_at=now()
        WHERE id=$1`,
      [id, status, note],
    );
  }

  async isFuture(id: string, tx: Queryable) {
    const r = await tx.query(
      "SELECT 1 FROM group_trip_requests WHERE id=$1 AND departure_at > now()",
      [id],
    );
    return Boolean(r.rowCount);
  }

  async listByUser(userId: string, page: PaginationQueryDto) {
    const [items, count] = await Promise.all([
      this.db.query<GroupTripResponse>(
        `SELECT ${ITEM} FROM ${FROM} WHERE g.user_id=$1 ORDER BY g.created_at DESC LIMIT $2 OFFSET $3`,
        [userId, page.limit, page.offset],
      ),
      this.db.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM group_trip_requests WHERE user_id=$1",
        [userId],
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  /** Office queue: pending first, soonest departure first. */
  async listForOffice(q: ListGroupTripsQueryDto) {
    const where = "($1::text IS NULL OR g.status=$1)";
    const params = [q.status ?? null];
    const [items, count] = await Promise.all([
      this.db.query<GroupTripResponse>(
        `SELECT ${ITEM} FROM ${FROM} WHERE ${where}
          ORDER BY CASE g.status WHEN 'PENDING' THEN 0 WHEN 'NEEDS_INFO' THEN 1 ELSE 2 END, g.departure_at
          LIMIT $2 OFFSET $3`,
        [...params, q.limit, q.offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ${FROM} WHERE ${where}`,
        params,
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }
}
