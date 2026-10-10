import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { FleetModule } from "../fleet/fleet.module.js";
import { TripsModule } from "../trips/trips.module.js";
import { SchedulesController } from "./schedules.controller.js";
import { SchedulesRepository } from "./schedules.repository.js";
import { SchedulesService } from "./schedules.service.js";

@Module({
  imports: [AuditModule, FleetModule, TripsModule],
  controllers: [SchedulesController],
  providers: [SchedulesRepository, SchedulesService],
})
export class SchedulesModule {}
