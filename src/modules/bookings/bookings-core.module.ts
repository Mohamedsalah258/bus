import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { BookingNotifier } from "./booking-notifier.js";
import { BookingsRepository } from "./bookings.repository.js";

/**
 * Booking data and passenger emails, shared by bookings, trips (trip
 * cancellation) and subscriptions (suspension) without a module cycle.
 */
@Module({
  imports: [NotificationsModule],
  providers: [BookingsRepository, BookingNotifier],
  exports: [BookingsRepository, BookingNotifier],
})
export class BookingsCoreModule {}
