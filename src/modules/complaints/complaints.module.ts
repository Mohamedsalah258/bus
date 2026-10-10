import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { ComplaintsController } from "./complaints.controller.js";
import { ComplaintsRepository } from "./complaints.repository.js";
import { ComplaintsService } from "./complaints.service.js";

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsRepository, ComplaintsService],
})
export class ComplaintsModule {}
