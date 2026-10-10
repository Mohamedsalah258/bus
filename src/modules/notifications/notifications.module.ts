import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { NotificationsAdminService } from "./notifications-admin.service.js";
import { NotificationsController } from "./notifications.controller.js";
import { APP_CONFIG, AppConfig } from "../../config/app-config.js";
import { MAILER } from "./mailer.js";
import { NotificationDispatcher } from "./notification.dispatcher.js";
import { NotificationsRepository } from "./notifications.repository.js";
import { NotificationsService } from "./notifications.service.js";
import { DisabledMailer, SmtpMailer } from "./smtp.mailer.js";

@Module({
  imports: [AuditModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationsAdminService,
    NotificationDispatcher,
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.mail.transport === "smtp"
          ? new SmtpMailer(config.mail)
          : new DisabledMailer(),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
