import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { CategoriesModule } from "../categories/categories.module.js";
import { UsersModule } from "../users/users.module.js";
import { UserManagementController } from "./user-management.controller.js";
import { UserManagementService } from "./user-management.service.js";

@Module({
  imports: [AuditModule, AuthModule, CategoriesModule, UsersModule],
  controllers: [UserManagementController],
  providers: [UserManagementService],
})
export class UserManagementModule {}
