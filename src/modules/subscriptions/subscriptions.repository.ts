import { Injectable } from "@nestjs/common";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { PlanResponse } from "../plans/dto/plan.dto.js";
import { ListSubscriptionsQueryDto } from "./dto/list-subscriptions-query.dto.js";
import {
  PaymentResponse,
  SubscriptionResponse,
  SubscriptionReviewItemResponse,
} from "./dto/subscription.response.js";
import {
  LIVE_STATUSES,
  PaymentStatus,
  SubscriptionStatus,
} from "./subscription-status.js";

/** Rows created before plans existed fall back to their season's dates. */
const FROM = `subscriptions s
  JOIN users u ON u.id = s.user_id
  JOIN routes r ON r.id = s.route_id
  JOIN seasons a ON a.id = s.season_id
  LEFT JOIN subscription_plans p ON p.id = s.plan_id`;
const CAIRO_TODAY = `(clock_timestamp() AT TIME ZONE 'Africa/Cairo')::date`;
const BASE = `s.id, s.user_id AS "userId", s.season_id AS "seasonId", s.plan_id AS "planId",
  s.route_id AS "routeId", s.status,
  COALESCE(p.ends_on, a.ends_on) < ${CAIRO_TODAY} AS "expired",
  COALESCE(p.starts_on, a.starts_on)::text AS "coversFrom",
  COALESCE(p.ends_on, a.ends_on)::text AS "coversUntil",
  s.fee_minor AS "feeMinor",
  COALESCE((SELECT sum(CASE sp.kind WHEN 'PAYMENT' THEN sp.amount_minor ELSE -sp.amount_minor END)
             FROM subscription_payments sp WHERE sp.subscription_id = s.id), 0)::int AS "paidMinor",
  s.payment_status AS "paymentStatus", s.reviewed_by AS "reviewedBy", s.reviewed_at AS "reviewedAt",
  s.review_reason AS "reviewReason", s.applicant_note AS "applicantNote",
  s.created_at AS "createdAt", s.updated_at AS "updatedAt"`;
const REVIEW_ITEM = `${BASE}, u.name AS "applicantName", u.email AS "applicantEmail",
  u.phone AS "applicantPhone", u.job_title AS "applicantJobTitle",
  u.faculty_id AS "applicantFacultyId", u.category_id AS "applicantCategoryId",
  r.name AS "routeName", COALESCE(p.name, a.name) AS "planName"`;

@Injectable()
export class SubscriptionsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Serializes one applicant's requests, so two overlapping plans cannot
   * both pass the overlap check. Lock order: user → subscription.
   */
  async lockApplicant(userId: string, tx: Queryable) {
    await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
  }

  async isRouteActive(routeId: string, tx: Queryable) {
    const result = await tx.query(
      "SELECT 1 FROM routes WHERE id=$1 AND active",
      [routeId],
    );
    return Boolean(result.rowCount);
  }

  /** The user's (active) category is on the route's eligibility list. */
  async isCategoryEligible(userId: string, routeId: string, tx: Queryable) {
    const result = await tx.query(
      `SELECT 1 FROM users u
         JOIN beneficiary_categories c ON c.id = u.category_id AND c.active
         JOIN route_eligible_categories e ON e.category_id = u.category_id
        WHERE u.id = $1 AND e.route_id = $2`,
      [userId, routeId],
    );
    return Boolean(result.rowCount);
  }

  /** A live subscription on this route already covers part of the dates. */
  async hasOverlappingLive(
    userId: string,
    routeId: string,
    from: string,
    until: string,
    tx: Queryable,
  ) {
    const result = await tx.query(
      `SELECT 1 FROM subscriptions s JOIN seasons a ON a.id = s.season_id
         LEFT JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.user_id=$1 AND s.route_id=$2 AND s.status = ANY($3::text[])
          AND COALESCE(p.starts_on, a.starts_on) <= $5::date
          AND COALESCE(p.ends_on, a.ends_on) >= $4::date`,
      [userId, routeId, LIVE_STATUSES, from, until],
    );
    return Boolean(result.rowCount);
  }

  async insert(
    userId: string,
    plan: PlanResponse,
    routeId: string,
    tx: Queryable,
  ) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO subscriptions(user_id,season_id,plan_id,route_id,fee_minor,payment_status)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        userId,
        plan.seasonId,
        plan.id,
        routeId,
        plan.feeMinor,
        plan.feeMinor > 0 ? PaymentStatus.Unpaid : PaymentStatus.NotRequired,
      ],
    );
    return rows[0]!.id;
  }

  async findReviewItem(id: string, tx: Queryable = this.db) {
    const { rows } = await tx.query<SubscriptionReviewItemResponse>(
      `SELECT ${REVIEW_ITEM} FROM ${FROM} WHERE s.id=$1`,
      [id],
    );
    return rows[0];
  }

  /** Locks the subscription row; returns it with applicant and route context. */
  async lockReviewItem(id: string, tx: Queryable) {
    const { rows } = await tx.query<SubscriptionReviewItemResponse>(
      `SELECT ${REVIEW_ITEM} FROM ${FROM} WHERE s.id=$1 FOR UPDATE OF s`,
      [id],
    );
    return rows[0];
  }

  async applyStaffTransition(
    id: string,
    to: SubscriptionStatus,
    reason: string,
    reviewerId: string,
    tx: Queryable,
  ) {
    await tx.query(
      `UPDATE subscriptions SET status=$2, review_reason=$3, reviewed_by=$4,
              reviewed_at=now(), updated_at=now() WHERE id=$1`,
      [id, to, reason, reviewerId],
    );
  }

  async applyOwnerTransition(
    id: string,
    to: SubscriptionStatus,
    note: string | null,
    tx: Queryable,
  ) {
    await tx.query(
      `UPDATE subscriptions SET status=$2, applicant_note=COALESCE($3, applicant_note),
              updated_at=now() WHERE id=$1`,
      [id, to, note],
    );
  }

  /**
   * Booking eligibility: approved, paid (or free), and the plan's dates
   * cover the trip's Cairo calendar date.
   */
  async coversTrip(
    userId: string,
    routeId: string,
    departureAt: Date,
    tx: Queryable,
  ) {
    const result = await tx.query(
      `SELECT 1 FROM subscriptions s JOIN seasons a ON a.id = s.season_id
         LEFT JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.user_id=$1 AND s.route_id=$2 AND s.status='APPROVED'
          AND s.payment_status IN ('NOT_REQUIRED','PAID')
          AND ($3::timestamptz AT TIME ZONE 'Africa/Cairo')::date
              BETWEEN COALESCE(p.starts_on, a.starts_on) AND COALESCE(p.ends_on, a.ends_on)`,
      [userId, routeId, departureAt],
    );
    return Boolean(result.rowCount);
  }

  async listByUser(userId: string, page: PaginationQueryDto) {
    const [items, count] = await Promise.all([
      this.db.query<SubscriptionResponse>(
        `SELECT ${BASE} FROM ${FROM} WHERE s.user_id=$1 ORDER BY s.created_at DESC LIMIT $2 OFFSET $3`,
        [userId, page.limit, page.offset],
      ),
      this.db.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM subscriptions WHERE user_id=$1",
        [userId],
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  /** Review queue; `facultyId` limits it to applicants of one faculty. */
  async listForReview(
    query: ListSubscriptionsQueryDto,
    facultyId: string | null,
  ) {
    const where = `($1::text IS NULL OR s.status = $1) AND ($2::uuid IS NULL OR u.faculty_id = $2)`;
    const params = [query.status ?? null, facultyId];
    const [items, count] = await Promise.all([
      this.db.query<SubscriptionReviewItemResponse>(
        `SELECT ${REVIEW_ITEM} FROM ${FROM} WHERE ${where} ORDER BY s.created_at DESC LIMIT $3 OFFSET $4`,
        [...params, query.limit, query.offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ${FROM} WHERE ${where}`,
        params,
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  // ---- payments ------------------------------------------------------------

  async insertPayment(
    subscriptionId: string,
    entry: {
      kind: "PAYMENT" | "REVERSAL" | "REFUND";
      amountMinor: number;
      method: string;
      reference?: string | null;
      paidOn: string;
      reversesPaymentId?: string | null;
      reason?: string | null;
    },
    recordedBy: string,
    tx: Queryable,
  ) {
    await tx.query(
      `INSERT INTO subscription_payments(subscription_id,kind,amount_minor,method,reference,paid_on,recorded_by,reverses_payment_id,reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        subscriptionId,
        entry.kind,
        entry.amountMinor,
        entry.method,
        entry.reference ?? null,
        entry.paidOn,
        recordedBy,
        entry.reversesPaymentId ?? null,
        entry.reason ?? null,
      ],
    );
  }

  /** A PAYMENT row of this subscription, and whether it was reversed already. */
  async findPayment(subscriptionId: string, paymentId: string, tx: Queryable) {
    const { rows } = await tx.query<{
      amountMinor: number;
      method: string;
      kind: string;
      reversed: boolean;
    }>(
      `SELECT amount_minor AS "amountMinor", method, kind,
              EXISTS (SELECT 1 FROM subscription_payments r
                       WHERE r.reverses_payment_id = p.id AND r.kind = 'REVERSAL') AS reversed
         FROM subscription_payments p WHERE p.id=$1 AND p.subscription_id=$2`,
      [paymentId, subscriptionId],
    );
    return rows[0];
  }

  async setPaymentStatus(id: string, status: PaymentStatus, tx: Queryable) {
    await tx.query(
      "UPDATE subscriptions SET payment_status=$2, updated_at=now() WHERE id=$1",
      [id, status],
    );
  }

  async listPayments(subscriptionId: string, tx: Queryable = this.db) {
    const { rows } = await tx.query<PaymentResponse>(
      `SELECT id, kind, amount_minor AS "amountMinor", method, reference, paid_on::text AS "paidOn",
              reverses_payment_id AS "reversesPaymentId", reason,
              recorded_by AS "recordedBy", created_at AS "createdAt"
         FROM subscription_payments WHERE subscription_id=$1 ORDER BY created_at`,
      [subscriptionId],
    );
    return rows;
  }

  async isFutureDate(date: string, tx: Queryable) {
    const { rows } = await tx.query<{ future: boolean }>(
      `SELECT $1::date > ${CAIRO_TODAY} AS future`,
      [date],
    );
    return rows[0]!.future;
  }
}
