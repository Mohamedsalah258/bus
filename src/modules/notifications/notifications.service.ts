import { Injectable } from "@nestjs/common";
import { Queryable } from "../../database/database.types.js";
import {
  NotificationTemplate,
  TemplatePayloads,
} from "./notification-template.js";
import { NotificationsRepository } from "./notifications.repository.js";

/**
 * Outbox API for other modules. `send` only writes a row inside the caller's
 * transaction: if the business change rolls back, no email goes out, and a
 * failing mail server never undoes a committed change.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly notifications: NotificationsRepository) {}

  send<T extends NotificationTemplate>(
    tx: Queryable,
    to: { userId: string | null; email: string },
    template: T,
    payload: TemplatePayloads[T],
    options: { sensitive?: boolean } = {},
  ) {
    return this.notifications.enqueue(
      {
        userId: to.userId,
        toEmail: to.email,
        template,
        payload,
        sensitive: options.sensitive,
      },
      tx,
    );
  }
}
