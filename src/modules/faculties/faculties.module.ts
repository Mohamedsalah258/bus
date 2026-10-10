import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { FacultiesController } from "./faculties.controller.js";
import { FacultiesRepository } from "./faculties.repository.js";
import { FacultiesService } from "./faculties.service.js";

@Module({
  imports: [AuditModule],
  controllers: [FacultiesController],
  providers: [FacultiesRepository, FacultiesService],
})
export class FacultiesModule {}
