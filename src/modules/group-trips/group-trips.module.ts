import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { FleetModule } from "../fleet/fleet.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { TripsModule } from "../trips/trips.module.js";
import { UsersModule } from "../users/users.module.js";
import { GroupTripsController } from "./group-trips.controller.js";
import { GroupTripsRepository } from "./group-trips.repository.js";
import { GroupTripsService } from "./group-trips.service.js";

@Module({
  imports: [
    AuditModule,
    FleetModule,
    NotificationsModule,
    TripsModule,
    UsersModule,
  ],
  controllers: [GroupTripsController],
  providers: [GroupTripsRepository, GroupTripsService],
})
export class GroupTripsModule {}
