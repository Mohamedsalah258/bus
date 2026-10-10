import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PlansController } from "./plans.controller.js";
import { PlansRepository } from "./plans.repository.js";
import { PlansService } from "./plans.service.js";

@Module({
  imports: [AuditModule],
  controllers: [PlansController],
  providers: [PlansRepository, PlansService],
  exports: [PlansRepository],
})
export class PlansModule {}
