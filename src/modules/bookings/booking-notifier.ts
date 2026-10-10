import { Injectable } from "@nestjs/common";
import { Queryable } from "../../database/database.types.js";
import { NotificationTemplate } from "../notifications/notification-template.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { BookingWithFacts } from "./bookings.repository.js";

/** BL-17: one place that turns booking events into passenger emails. */
@Injectable()
export class BookingNotifier {
  constructor(private readonly notifications: NotificationsService) {}

  confirmed(b: BookingWithFacts, tx: Queryable) {
    return this.send(b, NotificationTemplate.BookingConfirmed, tx);
  }

  cancelledByPassenger(b: BookingWithFacts, tx: Queryable) {
    return this.send(b, NotificationTemplate.BookingCancelled, tx);
  }

  async cancelledByAdmin(
    bookings: readonly BookingWithFacts[],
    reason: string,
    tx: Queryable,
  ) {
    for (const b of bookings)
      await this.notifications.send(
        tx,
        { userId: b.userId, email: b.email },
        NotificationTemplate.BookingCancelledByAdmin,
        { ...this.facts(b), reason },
      );
  }

  private send(
    b: BookingWithFacts,
    template:
      | typeof NotificationTemplate.BookingConfirmed
      | typeof NotificationTemplate.BookingCancelled,
    tx: Queryable,
  ) {
    return this.notifications.send(
      tx,
      { userId: b.userId, email: b.email },
      template,
      this.facts(b),
    );
  }

  private facts(b: BookingWithFacts) {
    return {
      name: b.name,
      routeName: b.routeName,
      boardingStopName: b.boardingStopName,
      direction: b.direction,
      departureAt: b.departureAt,
    };
  }
}
