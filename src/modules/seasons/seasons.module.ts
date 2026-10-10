import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { SeasonsController } from "./seasons.controller.js";
import { SeasonsRepository } from "./seasons.repository.js";
import { SeasonsService } from "./seasons.service.js";

@Module({
  imports: [AuditModule],
  controllers: [SeasonsController],
  providers: [SeasonsRepository, SeasonsService],
})
export class SeasonsModule {}
