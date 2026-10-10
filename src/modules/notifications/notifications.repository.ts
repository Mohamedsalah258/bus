import { Injectable } from "@nestjs/common";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import {
  ListNotificationsQueryDto,
  NotificationResponse,
} from "./dto/notification.dto.js";
import { NotificationTemplate } from "./notification-template.js";

export interface NewNotification {
  userId: string | null;
  toEmail: string;
  template: NotificationTemplate;
  payload: object;
  sensitive?: boolean;
}

export interface ClaimedNotification {
  id: string;
  toEmail: string;
  template: NotificationTemplate;
  payload: any;
  attempts: number;
}

/** Retry delays after each failed attempt; after the last one: FAILED. */
export const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600, 4 * 3600];
/** A SENDING row older than this belonged to a crashed worker. */
const STALE_CLAIM_SECONDS = 300;

@Injectable()
export class NotificationsRepository {
  constructor(private readonly db: Database) {}

  async enqueue(notification: NewNotification, tx: Queryable) {
    await tx.query(
      "INSERT INTO notifications(user_id,to_email,template,payload,sensitive) VALUES($1,$2,$3,$4,$5)",
      [
        notification.userId,
        notification.toEmail,
        notification.template,
        JSON.stringify(notification.payload),
        notification.sensitive ?? false,
      ],
    );
  }

  /**
   * Claims due rows. SKIP LOCKED lets several API instances dispatch
   * concurrently without sending the same email twice.
   */
  async claimDue(limit: number) {
    const { rows } = await this.db.query<ClaimedNotification>(
      `UPDATE notifications SET status='SENDING', claimed_at=now(), attempts=attempts+1
        WHERE id IN (
          SELECT id FROM notifications
           WHERE (status='PENDING' AND next_attempt_at <= now())
              OR (status='SENDING' AND claimed_at < now() - make_interval(secs => $2))
           ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id, to_email AS "toEmail", template, payload, attempts`,
      [limit, STALE_CLAIM_SECONDS],
    );
    return rows;
  }

  async markSent(id: string) {
    await this.db.query(
      `UPDATE notifications SET status='SENT', sent_at=now(), claimed_at=NULL, last_error=NULL,
              payload = CASE WHEN sensitive THEN '{}'::jsonb ELSE payload END
        WHERE id=$1`,
      [id],
    );
  }

  /** Schedules a retry, or gives up after the last delay. */
  async markFailed(id: string, attempts: number, error: string) {
    const delay = RETRY_DELAYS_SECONDS.at(attempts - 1);
    if (delay === undefined)
      await this.db.query(
        `UPDATE notifications SET status='FAILED', claimed_at=NULL, last_error=$2,
                payload = CASE WHEN sensitive THEN '{}'::jsonb ELSE payload END
          WHERE id=$1`,
        [id, error],
      );
    else
      await this.db.query(
        `UPDATE notifications SET status='PENDING', claimed_at=NULL, last_error=$2,
                next_attempt_at = now() + make_interval(secs => $3) WHERE id=$1`,
        [id, error, delay],
      );
  }

  async list(q: ListNotificationsQueryDto) {
    const where = "status=$1 AND ($2::text IS NULL OR template=$2)";
    const params = [q.status ?? "FAILED", q.template ?? null];
    const [items, count] = await Promise.all([
      this.db.query<NotificationResponse>(
        `SELECT id, to_email AS "toEmail", template, status, attempts, last_error AS "lastError",
                NOT sensitive AS retryable, created_at AS "createdAt", sent_at AS "sentAt"
           FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        [...params, q.limit, q.offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM notifications WHERE ${where}`,
        params,
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  /** Requeues a failed, non-sensitive notification for immediate delivery. */
  async retry(id: string) {
    const { rows } = await this.db.query<{ outcome: string }>(
      `WITH target AS (SELECT id, status, sensitive FROM notifications WHERE id=$1 FOR UPDATE),
            done AS (UPDATE notifications n SET status='PENDING', attempts=0, next_attempt_at=now(), last_error=NULL
                       FROM target t WHERE n.id=t.id AND t.status='FAILED' AND NOT t.sensitive RETURNING n.id)
       SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'missing'
                   WHEN EXISTS (SELECT 1 FROM done) THEN 'requeued'
                   WHEN (SELECT sensitive FROM target) THEN 'sensitive'
                   ELSE 'not-failed' END AS outcome`,
      [id],
    );
    return rows[0]!.outcome as
      "missing" | "requeued" | "sensitive" | "not-failed";
  }
}
