import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { CategoriesModule } from "../categories/categories.module.js";
import { RoutesController } from "./routes.controller.js";
import { RoutesRepository } from "./routes.repository.js";
import { RoutesService } from "./routes.service.js";

@Module({
  imports: [AuditModule, CategoriesModule],
  controllers: [RoutesController],
  providers: [RoutesRepository, RoutesService],
  exports: [RoutesRepository],
})
export class RoutesModule {}
