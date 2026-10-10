import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../../config/app-config.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import { CategoriesRepository } from "../categories/categories.repository.js";
import { NotificationTemplate } from "../notifications/notification-template.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { UserRole } from "../users/user-role.js";
import { UsersRepository } from "../users/users.repository.js";
import { AuthenticatedUser } from "./auth.types.js";
import {
  MfaChallengeResponse,
  RegisterResponse,
  TokenPairResponse,
} from "./dto/auth.responses.js";
import { LoginDto } from "./dto/login.dto.js";
import { ResetPasswordWithCodeDto } from "./dto/email-otp.dto.js";
import { UpdateProfileDto } from "./dto/profile.dto.js";
import { ChangePasswordDto } from "./dto/mfa.dto.js";
import { RegisterDto } from "./dto/register.dto.js";
import { MfaService } from "./mfa/mfa.service.js";
import { EmailOtpPurpose } from "./otp/email-otp.js";
import { EmailOtpService } from "./otp/email-otp.service.js";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "./password.js";
import { SessionsService } from "./sessions.service.js";
import { LoginThrottleRepository } from "./throttle/login-throttle.repository.js";
import { parseRefreshToken, secretMatches } from "./tokens/refresh-token.js";
import { RefreshTokensRepository } from "./tokens/refresh-tokens.repository.js";
import { TokenService } from "./tokens/token.service.js";

const INVALID_REFRESH = "Invalid or expired refresh token";
const INVALID_CODE = "Invalid or expired code";
const SIGN_IN_MESSAGE =
  "If this email can sign in, a code has been sent. It is valid for 10 minutes.";
/** Identical whether or not the email exists: no account enumeration. */
const FORGOT_MESSAGE =
  "If an active account uses this email, a reset code has been sent.";
const tooMany = () =>
  new HttpException(
    "Too many failed attempts. Try again in a minute.",
    HttpStatus.TOO_MANY_REQUESTS,
  );

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly categories: CategoriesRepository,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly sessions: SessionsService,
    private readonly loginThrottle: LoginThrottleRepository,
    private readonly mfa: MfaService,
    private readonly emailOtp: EmailOtpService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ---- password-free sign-in for members ---------------------------------

  /**
   * Emails a sign-in code. The answer is the same for new and existing
   * emails; staff accounts never receive one (they use password + MFA).
   */
  async requestSignInCode(email: string) {
    this.assertAllowedDomain(email);
    try {
      await this.db.transaction(async (tx) => {
        const user = await this.users.findCodeSignInTarget(email, tx);
        if (user && (!user.active || user.role !== UserRole.Member)) return;
        await this.emailOtp.issue(
          { id: user?.id, email, name: user?.name ?? null },
          EmailOtpPurpose.SignIn,
          tx,
          { enforceLimits: true },
        );
      });
    } catch (error) {
      // A cooldown hit must look like success, or it reveals activity.
      if (!(error instanceof HttpException && error.getStatus() === 429))
        throw error;
    }
    return { message: SIGN_IN_MESSAGE };
  }

  /**
   * Checks the code; the first success for an email creates the member
   * (verified, no password). Members with MFA still get the challenge.
   */
  async verifySignInCode(
    email: string,
    code: string,
  ): Promise<TokenPairResponse | MfaChallengeResponse> {
    this.assertAllowedDomain(email);
    const key = `code:${email}`;
    if (await this.loginThrottle.isBlocked(key)) throw tooMany();
    const outcome = await this.db.transaction(async (tx) => {
      if (
        !(await this.emailOtp.consume(
          { email },
          EmailOtpPurpose.SignIn,
          code,
          tx,
        ))
      )
        return null;
      const existing = await this.users.findCodeSignInTarget(email, tx);
      if (existing && (!existing.active || existing.role !== UserRole.Member))
        return null;
      const user =
        existing ?? (await this.users.createPasswordlessMember(email, tx));
      await this.users.markEmailVerified(user.id, tx);
      if (user.mfaEnabled) return { challenge: user };
      return { pair: await this.tokens.issuePair(user, tx) };
    });
    if (!outcome) {
      await this.loginThrottle.recordFailure(key);
      throw new BadRequestException(INVALID_CODE);
    }
    await this.loginThrottle.clear(key);
    return "pair" in outcome
      ? outcome.pair!
      : this.mfa.challenge(outcome.challenge!);
  }

  /**
   * Members edit their whole profile. Staff may edit name, phone and job
   * title only: a coordinator's faculty is their review scope, set by an admin.
   */
  async updateProfile(user: AuthenticatedUser, dto: UpdateProfileDto) {
    const changesScope =
      dto.facultyId !== undefined || dto.categoryId !== undefined;
    if (changesScope && user.role !== UserRole.Member)
      throw new ForbiddenException(
        "Faculty and category of staff accounts are set by an administrator",
      );
    if (dto.categoryId && !(await this.categories.allActive([dto.categoryId])))
      throw new BadRequestException("Unknown or inactive category");
    await this.db.transaction(async (tx) => {
      const before = await this.users.updateProfile(user.id, dto, tx);
      if (changesScope)
        await this.audit.record(tx, {
          actorId: user.id,
          action: AuditAction.ProfileScopeChanged,
          entityId: user.id,
          metadata: {
            facultyId: {
              from: before.previousFacultyId,
              to: dto.facultyId ?? before.previousFacultyId,
            },
            categoryId: {
              from: before.previousCategoryId,
              to: dto.categoryId ?? before.previousCategoryId,
            },
          },
        });
    });
    return (await this.users.findAuthSnapshotById(user.id))!;
  }

  private assertAllowedDomain(email: string) {
    const allowed = this.config.allowedEmailDomains;
    if (allowed.length && !allowed.includes(email.split("@").at(-1)!))
      throw new BadRequestException(
        `Use your university email (${allowed.join(", ")})`,
      );
  }

  // ---- BL-33: change of email ----------------------------------------------

  /** Sends a code to the new address; nothing changes until it is entered. */
  async requestEmailChange(user: AuthenticatedUser, newEmail: string) {
    this.assertAllowedDomain(newEmail);
    if (newEmail === user.email)
      throw new BadRequestException("That is already your email");
    await this.db.transaction(async (tx) => {
      if (await this.users.emailInUse(newEmail, tx))
        throw new ConflictException("This email cannot be used");
      await this.users.setPendingEmail(user.id, newEmail, tx);
      await this.emailOtp.issue(
        { id: user.id, email: newEmail, name: user.name },
        EmailOtpPurpose.ChangeEmail,
        tx,
        {
          enforceLimits: true,
        },
      );
      await this.audit.record(tx, {
        actorId: user.id,
        action: AuditAction.EmailChangeRequested,
        entityId: user.id,
      });
    });
  }

  /** Switches the sign-in email and warns the old address. */
  confirmEmailChange(user: AuthenticatedUser, code: string) {
    return this.withCode(async (tx) => {
      if (
        !(await this.emailOtp.consume(
          { userId: user.id },
          EmailOtpPurpose.ChangeEmail,
          code,
          tx,
        ))
      )
        return false;
      const changed = await this.users.applyPendingEmail(user.id, tx);
      if (!changed?.newEmail) return false;
      await this.notifications.send(
        tx,
        { userId: user.id, email: changed.oldEmail },
        NotificationTemplate.EmailChanged,
        {
          name: changed.name ?? "",
          newEmailMasked: maskEmail(changed.newEmail),
        },
      );
      await this.audit.record(tx, {
        actorId: user.id,
        action: AuditAction.EmailChanged,
        entityId: user.id,
      });
      return true;
    });
  }

  /** Creates an unverified MEMBER and emails a verification code. */
  async register(dto: RegisterDto): Promise<RegisterResponse> {
    this.assertAllowedDomain(dto.email);
    if (!(await this.categories.allActive([dto.categoryId])))
      throw new BadRequestException("Unknown or inactive category");
    const passwordHash = await hashPassword(dto.password);
    const user = await this.db.transaction(async (tx) => {
      const created = await this.users.create(
        {
          email: dto.email,
          name: dto.name,
          passwordHash,
          role: UserRole.Member,
          facultyId: dto.facultyId,
          categoryId: dto.categoryId,
          passwordChangeRequired: false,
        },
        tx,
      );
      await this.emailOtp.issue(created, EmailOtpPurpose.VerifyEmail, tx, {
        enforceLimits: false,
      });
      return created;
    });
    const {
      active: _a,
      emailVerified: _e,
      passwordChangeRequired: _p,
      mfaEnabled: _m,
      createdAt: _c,
      ...publicUser
    } = user;
    return {
      user: publicUser,
      message:
        "Account created. Enter the code sent to your email, then request a subscription; eligibility requires administrative approval.",
    };
  }

  verifyEmail(userId: string, code: string) {
    return this.withCode(async (tx) => {
      if (
        !(await this.emailOtp.consume(
          { userId },
          EmailOtpPurpose.VerifyEmail,
          code,
          tx,
        ))
      )
        return false;
      await this.users.markEmailVerified(userId, tx);
      return true;
    });
  }

  resendVerification(user: AuthenticatedUser) {
    if (user.emailVerified)
      throw new BadRequestException("Email is already verified");
    return this.db.transaction((tx) =>
      this.emailOtp.issue(user, EmailOtpPurpose.VerifyEmail, tx, {
        enforceLimits: true,
      }),
    );
  }

  /** Always answers the same way; only active accounts receive a code. */
  async forgotPassword(email: string) {
    try {
      await this.db.transaction(async (tx) => {
        const user = await this.users.findRecoveryTarget(email, tx);
        if (user?.active)
          await this.emailOtp.issue(user, EmailOtpPurpose.ResetPassword, tx, {
            enforceLimits: true,
          });
      });
    } catch (error) {
      // A cooldown hit must look like success, or it reveals the account.
      if (!(error instanceof HttpException && error.getStatus() === 429))
        throw error;
    }
    return { message: FORGOT_MESSAGE };
  }

  /**
   * Sets a new password with an emailed code. Proves control of the inbox,
   * so it also verifies the email and lifts a forced password change.
   */
  async resetPasswordWithCode(dto: ResetPasswordWithCodeDto) {
    const key = `reset:${dto.email}`;
    if (await this.loginThrottle.isBlocked(key)) throw tooMany();
    const passwordHash = await hashPassword(dto.newPassword);
    const ok = await this.db.transaction(async (tx) => {
      const user = await this.users.findRecoveryTarget(dto.email, tx);
      if (!user?.active) return false;
      if (
        !(await this.emailOtp.consume(
          { userId: user.id },
          EmailOtpPurpose.ResetPassword,
          dto.code,
          tx,
        ))
      )
        return false;
      await this.users.setPassword(user.id, passwordHash, false, tx);
      await this.users.markEmailVerified(user.id, tx);
      await this.sessions.revokeAll(user.id, tx);
      await this.audit.record(tx, {
        actorId: user.id,
        action: AuditAction.PasswordResetByEmail,
        entityId: user.id,
      });
      return true;
    });
    if (!ok) {
      await this.loginThrottle.recordFailure(key);
      throw new BadRequestException(INVALID_CODE);
    }
    await this.loginThrottle.clear(key);
  }

  /**
   * Runs a code check and COMMITS even when the code is wrong, so the
   * attempt counter is kept; the error is raised after the commit.
   */
  private async withCode(work: (tx: Queryable) => Promise<boolean>) {
    if (!(await this.db.transaction(work)))
      throw new BadRequestException(INVALID_CODE);
  }

  /**
   * Password step. Accounts with a second factor get a short-lived MFA
   * challenge instead of tokens.
   */
  async login(
    dto: LoginDto,
  ): Promise<TokenPairResponse | MfaChallengeResponse> {
    // Same answer for known and unknown emails: the limit leaks nothing.
    if (await this.loginThrottle.isBlocked(dto.email)) throw tooMany();
    const user = await this.users.findCredentialsByEmail(dto.email);
    // Run the KDF even for unknown accounts to avoid a cheap timing shortcut.
    const valid = await verifyPassword(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user?.active || !valid) {
      await this.loginThrottle.recordFailure(dto.email);
      throw new UnauthorizedException("Invalid email or password");
    }
    await this.loginThrottle.clear(dto.email);
    if (user.mfaEnabled) return this.mfa.challenge(user);
    return this.db.transaction((tx) => this.tokens.issuePair(user, tx));
  }

  /**
   * Rotates a refresh token. Replaying an already-used token revokes the
   * whole session family and is audited; revoked or expired tokens are
   * simply rejected.
   */
  async refresh(token: string): Promise<TokenPairResponse> {
    const parsed = parseRefreshToken(token);
    if (!parsed) throw new UnauthorizedException(INVALID_REFRESH);

    const outcome = await this.db.transaction(async (tx) => {
      const row = await this.refreshTokens.lockById(parsed.id, tx);
      if (!row || !secretMatches(parsed.secret, row.tokenHash))
        return { ok: false as const };
      // Revoked (logout, earlier replay): reject quietly.
      if (row.revokedAt) return { ok: false as const };
      // Used once already: a replay, so assume theft and end the session.
      if (row.usedAt) {
        await this.refreshTokens.revokeFamily(row.familyId, tx);
        await this.audit.record(tx, {
          actorId: row.userId,
          action: AuditAction.RefreshTokenReuseDetected,
          entityId: row.familyId,
        });
        return { ok: false as const };
      }
      if (row.expired) return { ok: false as const };
      const user = await this.users.findAuthSnapshotById(row.userId, tx);
      if (!user?.active || user.tokenVersion !== row.tokenVersion) {
        await this.refreshTokens.revokeFamily(row.familyId, tx);
        return { ok: false as const };
      }
      await this.refreshTokens.markUsed(row.id, tx);
      return {
        ok: true as const,
        pair: await this.tokens.issuePair(user, tx, row.familyId),
      };
    });
    // Thrown after commit so a detected replay's revocation is persisted.
    if (!outcome.ok) throw new UnauthorizedException(INVALID_REFRESH);
    return outcome.pair;
  }

  /**
   * Changes the caller's password, ends every other session and returns a
   * fresh token pair. Wrong current passwords count toward the login limit.
   */
  async changePassword(
    user: AuthenticatedUser,
    dto: ChangePasswordDto,
  ): Promise<TokenPairResponse> {
    if (await this.loginThrottle.isBlocked(user.email)) throw tooMany();
    if (dto.newPassword === dto.currentPassword)
      throw new BadRequestException("Choose a password you have not just used");
    const newHash = await hashPassword(dto.newPassword);
    const outcome = await this.db.transaction(async (tx) => {
      const current = await this.users.findPasswordHash(user.id, tx);
      if (!current || !(await verifyPassword(dto.currentPassword, current)))
        return null;
      await this.users.setPassword(user.id, newHash, false, tx);
      await this.sessions.revokeAll(user.id, tx);
      await this.audit.record(tx, {
        actorId: user.id,
        action: AuditAction.PasswordChanged,
        entityId: user.id,
      });
      const fresh = await this.users.findAuthSnapshotById(user.id, tx);
      return this.tokens.issuePair(fresh!, tx);
    });
    if (!outcome) {
      await this.loginThrottle.recordFailure(user.email);
      throw new UnauthorizedException("Current password is incorrect");
    }
    await this.loginThrottle.clear(user.email);
    return outcome;
  }

  /** Invalidates every access and refresh token issued to the user. */
  logout(userId: string) {
    return this.db.transaction((tx) => this.sessions.revokeAll(userId, tx));
  }
}

/** «a***@bsu.edu.eg»: enough to recognise, not enough to harvest. */
function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local!.slice(0, 1)}***@${domain}`;
}
