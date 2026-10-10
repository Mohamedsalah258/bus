import { Module } from "@nestjs/common";
import { AuditController } from "./audit.controller.js";
import { AuditRepository } from "./audit.repository.js";
import { AuditService } from "./audit.service.js";

@Module({
  controllers: [AuditController],
  providers: [AuditRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
