import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { RoutesModule } from "../routes/routes.module.js";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module.js";
import { TripsModule } from "../trips/trips.module.js";
import { UsersModule } from "../users/users.module.js";
import { BookingsCoreModule } from "./bookings-core.module.js";
import { BookingsController } from "./bookings.controller.js";
import { BookingsService } from "./bookings.service.js";

@Module({
  imports: [
    AuditModule,
    BookingsCoreModule,
    RoutesModule,
    SubscriptionsModule,
    TripsModule,
    UsersModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
