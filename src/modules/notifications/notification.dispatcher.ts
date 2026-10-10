import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../../config/app-config.js";
import { MAILER, Mailer } from "./mailer.js";
import { renderTemplate } from "./notification-template.js";
import { NotificationsRepository } from "./notifications.repository.js";

const BATCH_SIZE = 20;

/** Delivers the outbox in the background with retries and backoff. */
@Injectable()
export class NotificationDispatcher
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger("Notifications");
  private timer?: NodeJS.Timeout;
  private running?: Promise<number>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly notifications: NotificationsRepository,
  ) {}

  onApplicationBootstrap() {
    const { transport, pollIntervalMs } = this.config.mail;
    if (transport === "disabled") {
      this.logger.warn({
        msg: "mail transport disabled: notifications stay queued",
      });
      return;
    }
    if (pollIntervalMs === 0) return;
    this.timer = setInterval(() => void this.tick(), pollIntervalMs);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.running;
  }

  /** One pass over due notifications; returns how many were attempted. */
  async runOnce(): Promise<number> {
    const due = await this.notifications.claimDue(BATCH_SIZE);
    for (const notification of due) {
      try {
        await this.mailer.send(
          notification.toEmail,
          renderTemplate(notification.template, notification.payload),
        );
        await this.notifications.markSent(notification.id);
        this.logger.log({
          msg: "notification sent",
          notificationId: notification.id,
          template: notification.template,
        });
      } catch (error) {
        // The error class/code only: SMTP messages can echo addresses.
        const reason =
          (error as { code?: string; responseCode?: number })?.code ??
          (error instanceof Error ? error.constructor.name : "Error");
        await this.notifications.markFailed(
          notification.id,
          notification.attempts,
          String(reason),
        );
        this.logger.warn({
          msg: "notification delivery failed",
          notificationId: notification.id,
          attempts: notification.attempts,
          reason,
        });
      }
    }
    return due.length;
  }

  private async tick() {
    if (this.running) return; // never overlap passes
    this.running = this.runOnce()
      .catch((error) => {
        this.logger.error({
          msg: "dispatcher pass failed",
          type: error?.constructor?.name,
        });
        return 0;
      })
      .finally(() => (this.running = undefined));
  }
}
