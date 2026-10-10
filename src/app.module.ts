import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AppThrottlerGuard } from "./common/http/throttler.guard.js";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { AuthGuard } from "./modules/auth/guards/auth.guard.js";
import { BookingsModule } from "./modules/bookings/bookings.module.js";
import { CategoriesModule } from "./modules/categories/categories.module.js";
import { ComplaintsModule } from "./modules/complaints/complaints.module.js";
import { FacultiesModule } from "./modules/faculties/faculties.module.js";
import { FleetModule } from "./modules/fleet/fleet.module.js";
import { GroupTripsModule } from "./modules/group-trips/group-trips.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { NewsModule } from "./modules/news/news.module.js";
import { ReportsModule } from "./modules/reports/reports.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { PlansModule } from "./modules/plans/plans.module.js";
import { RoutesModule } from "./modules/routes/routes.module.js";
import { SchedulesModule } from "./modules/schedules/schedules.module.js";
import { SeasonsModule } from "./modules/seasons/seasons.module.js";
import { SubscriptionsModule } from "./modules/subscriptions/subscriptions.module.js";
import { TripsModule } from "./modules/trips/trips.module.js";
import { UserManagementModule } from "./modules/user-management/user-management.module.js";

@Module({
  imports: [
    // Infrastructure
    ConfigModule,
    DatabaseModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    // Platform
    HealthModule,
    AuthModule,
    AuditModule,
    NotificationsModule,
    UserManagementModule,
    // Catalog
    FacultiesModule,
    CategoriesModule,
    SeasonsModule,
    PlansModule,
    RoutesModule,
    FleetModule,
    // Operations
    SubscriptionsModule,
    TripsModule,
    SchedulesModule,
    BookingsModule,
    ComplaintsModule,
    GroupTripsModule,
    ReportsModule,
    NewsModule,
  ],
  providers: [
    // Order matters: rate limit first, then authentication/authorization.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
export class AppModule {}
