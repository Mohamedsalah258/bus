import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { DriversController } from "./drivers.controller.js";
import { DriversRepository } from "./drivers.repository.js";
import { FleetUsageRepository } from "./fleet-usage.repository.js";
import { FleetService } from "./fleet.service.js";
import { VehiclesController } from "./vehicles.controller.js";
import { VehiclesRepository } from "./vehicles.repository.js";

@Module({
  imports: [AuditModule],
  controllers: [VehiclesController, DriversController],
  providers: [
    VehiclesRepository,
    DriversRepository,
    FleetUsageRepository,
    FleetService,
  ],
  exports: [VehiclesRepository, DriversRepository],
})
export class FleetModule {}
