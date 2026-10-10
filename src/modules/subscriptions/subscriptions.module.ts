import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { BookingsCoreModule } from "../bookings/bookings-core.module.js";
import { CategoriesModule } from "../categories/categories.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { UsersModule } from "../users/users.module.js";
import { PlansModule } from "../plans/plans.module.js";
import { SubscriptionsController } from "./subscriptions.controller.js";
import { SubscriptionsRepository } from "./subscriptions.repository.js";
import { SubscriptionsService } from "./subscriptions.service.js";

@Module({
  imports: [
    AuditModule,
    BookingsCoreModule,
    CategoriesModule,
    NotificationsModule,
    PlansModule,
    UsersModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsRepository, SubscriptionsService],
  exports: [SubscriptionsRepository],
})
export class SubscriptionsModule {}
