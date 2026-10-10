import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { BookingsCoreModule } from "../bookings/bookings-core.module.js";
import { FleetModule } from "../fleet/fleet.module.js";
import { RoutesModule } from "../routes/routes.module.js";
import { TripsController } from "./trips.controller.js";
import { TripsRepository } from "./trips.repository.js";
import { TripsService } from "./trips.service.js";

@Module({
  imports: [AuditModule, BookingsCoreModule, FleetModule, RoutesModule],
  controllers: [TripsController],
  providers: [TripsRepository, TripsService],
  exports: [TripsRepository],
})
export class TripsModule {}
