import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsRepository } from "./reports.repository.js";
import { ReportsService } from "./reports.service.js";

@Module({
  imports: [AuditModule],
  controllers: [ReportsController],
  providers: [ReportsRepository, ReportsService],
})
export class ReportsModule {}
