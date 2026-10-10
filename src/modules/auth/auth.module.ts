import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { APP_CONFIG, AppConfig } from "../../config/app-config.js";
import { AuditModule } from "../audit/audit.module.js";
import { CategoriesModule } from "../categories/categories.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { UsersModule } from "../users/users.module.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from "./auth.constants.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { AuthGuard } from "./guards/auth.guard.js";
import { MfaService } from "./mfa/mfa.service.js";
import { RecoveryCodesRepository } from "./mfa/recovery-codes.repository.js";
import { EmailOtpService } from "./otp/email-otp.service.js";
import { EmailOtpsRepository } from "./otp/email-otps.repository.js";
import { SessionsService } from "./sessions.service.js";
import { LoginThrottleRepository } from "./throttle/login-throttle.repository.js";
import { RefreshTokensRepository } from "./tokens/refresh-tokens.repository.js";
import { TokenService } from "./tokens/token.service.js";

@Module({
  imports: [
    AuditModule,
    CategoriesModule,
    NotificationsModule,
    UsersModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        signOptions: {
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          algorithm: JWT_ALGORITHM,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    MfaService,
    SessionsService,
    EmailOtpService,
    EmailOtpsRepository,
    TokenService,
    RecoveryCodesRepository,
    RefreshTokensRepository,
    LoginThrottleRepository,
  ],
  // AuthGuard is registered globally by AppModule so guard order stays explicit.
  // Sessions and MFA reset are used by user administration.
  exports: [AuthGuard, SessionsService, MfaService, EmailOtpService],
})
export class AuthModule {}
