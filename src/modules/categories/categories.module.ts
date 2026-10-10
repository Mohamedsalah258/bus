import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { CategoriesController } from "./categories.controller.js";
import { CategoriesRepository } from "./categories.repository.js";
import { CategoriesService } from "./categories.service.js";

@Module({
  imports: [AuditModule],
  controllers: [CategoriesController],
  providers: [CategoriesRepository, CategoriesService],
  exports: [CategoriesRepository],
})
export class CategoriesModule {}
