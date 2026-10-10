import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { APP_CONFIG, AppConfig } from "../../../config/app-config.js";
import { Database } from "../../../database/database.service.js";
import { Queryable } from "../../../database/database.types.js";
import { AuditAction } from "../../audit/audit-action.js";
import { AuditService } from "../../audit/audit.service.js";
import { UsersRepository } from "../../users/users.repository.js";
import {
  JWT_ALGORITHM,
  JWT_ISSUER,
  MFA_ISSUER_LABEL,
  MFA_TOKEN_AUDIENCE,
  MFA_TOKEN_TTL_SECONDS,
} from "../auth.constants.js";
import { AuthenticatedUser, MfaTokenClaims } from "../auth.types.js";
import {
  MfaActivatedResponse,
  MfaChallengeResponse,
  MfaSetupResponse,
  TokenPairResponse,
} from "../dto/auth.responses.js";
import { MfaVerifyDto } from "../dto/mfa.dto.js";
import { SessionsService } from "../sessions.service.js";
import { LoginThrottleRepository } from "../throttle/login-throttle.repository.js";
import { TokenService } from "../tokens/token.service.js";
import { generateRecoveryCodes, hashRecoveryCode } from "./recovery-codes.js";
import { RecoveryCodesRepository } from "./recovery-codes.repository.js";
import { open, seal } from "./secret-box.js";
import {
  base32Decode,
  generateTotpSecret,
  otpauthUrl,
  verifyTotp,
} from "./totp.js";

const INVALID = "Invalid or expired verification";

@Injectable()
export class MfaService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly users: UsersRepository,
    private readonly recoveryCodes: RecoveryCodesRepository,
    private readonly sessions: SessionsService,
    private readonly tokens: TokenService,
    private readonly throttle: LoginThrottleRepository,
    private readonly audit: AuditService,
  ) {}

  /** Step 1 of enrolment: a fresh secret, not active until confirmed. */
  setup(user: AuthenticatedUser): Promise<MfaSetupResponse> {
    return this.db.transaction(async (tx) => {
      const state = await this.users.findMfaState(user.id, tx);
      if (state?.mfaEnabled)
        throw new ConflictException(
          "Two-factor authentication is already enabled",
        );
      const secret = generateTotpSecret();
      await this.users.setPendingMfaSecret(
        user.id,
        seal(secret, this.config.mfaEncryptionKey),
        tx,
      );
      return {
        secret,
        otpauthUrl: otpauthUrl(secret, user.email, MFA_ISSUER_LABEL),
      };
    });
  }

  /**
   * Step 2: a valid code proves the app holds the secret. Issues recovery
   * codes and ends every session so the next login goes through MFA.
   */
  activate(userId: string, code: string): Promise<MfaActivatedResponse> {
    return this.db.transaction(async (tx) => {
      const state = await this.users.findMfaState(userId, tx);
      if (!state) throw new UnauthorizedException();
      if (state.mfaEnabled)
        throw new ConflictException(
          "Two-factor authentication is already enabled",
        );
      if (!state.mfaPendingSecretEnc)
        throw new BadRequestException("Start two-factor setup first");
      const step = verifyTotp(this.secretOf(state.mfaPendingSecretEnc), code);
      if (step === null)
        throw new BadRequestException("Invalid verification code");

      await this.users.enableMfa(userId, step, tx);
      const codes = generateRecoveryCodes();
      await this.recoveryCodes.replaceAll(
        userId,
        codes.map(hashRecoveryCode),
        tx,
      );
      await this.sessions.revokeAll(userId, tx);
      await this.audit.record(tx, {
        actorId: userId,
        action: AuditAction.MfaEnabled,
        entityId: userId,
      });
      return { recoveryCodes: codes };
    });
  }

  async challenge(user: {
    id: string;
    tokenVersion: number;
  }): Promise<MfaChallengeResponse> {
    const claims: MfaTokenClaims = {
      sub: user.id,
      ver: user.tokenVersion,
      purpose: "mfa",
    };
    return {
      mfaRequired: true,
      mfaToken: await this.jwt.signAsync(claims, {
        audience: MFA_TOKEN_AUDIENCE,
        expiresIn: MFA_TOKEN_TTL_SECONDS,
      }),
      mfaTokenExpiresIn: MFA_TOKEN_TTL_SECONDS,
    };
  }

  /** Second login step: TOTP code (not reusable) or a single-use recovery code. */
  async verify(dto: MfaVerifyDto): Promise<TokenPairResponse> {
    if (Boolean(dto.code) === Boolean(dto.recoveryCode))
      throw new BadRequestException("Send either code or recoveryCode");
    let claims: MfaTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<MfaTokenClaims>(dto.mfaToken, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: MFA_TOKEN_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException(INVALID);
    }
    if (claims.purpose !== "mfa") throw new UnauthorizedException(INVALID);

    const key = `mfa:${claims.sub}`;
    if (await this.throttle.isBlocked(key))
      throw new HttpException(
        "Too many failed attempts. Try again in a minute.",
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const outcome = await this.db.transaction(async (tx) => {
      const user = await this.users.findAuthSnapshotById(claims.sub, tx);
      const state = await this.users.findMfaState(claims.sub, tx);
      if (
        !user?.active ||
        user.tokenVersion !== claims.ver ||
        !state?.mfaEnabled ||
        !state.mfaSecretEnc
      )
        return null;
      const accepted = dto.code
        ? await this.acceptCode(user.id, state.mfaSecretEnc, dto.code, tx)
        : await this.acceptRecoveryCode(user.id, dto.recoveryCode!, tx);
      return accepted ? this.tokens.issuePair(user, tx) : null;
    });
    if (!outcome) {
      await this.throttle.recordFailure(key);
      throw new UnauthorizedException(INVALID);
    }
    await this.throttle.clear(key);
    return outcome;
  }

  /**
   * BL-35. New recovery codes replace every old one; a current TOTP code
   * proves the authenticator is still in hand. Wrong codes count toward
   * the per-account limit.
   */
  async regenerateRecoveryCodes(
    userId: string,
    code: string,
  ): Promise<MfaActivatedResponse> {
    const key = `mfa:${userId}`;
    if (await this.throttle.isBlocked(key))
      throw new HttpException(
        "Too many failed attempts. Try again in a minute.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const codes = await this.db.transaction(async (tx) => {
      const state = await this.users.findMfaState(userId, tx);
      if (!state?.mfaEnabled || !state.mfaSecretEnc)
        throw new ConflictException("Two-factor authentication is not enabled");
      if (!(await this.acceptCode(userId, state.mfaSecretEnc, code, tx)))
        return null;
      const fresh = generateRecoveryCodes();
      await this.recoveryCodes.replaceAll(
        userId,
        fresh.map(hashRecoveryCode),
        tx,
      );
      await this.audit.record(tx, {
        actorId: userId,
        action: AuditAction.MfaRecoveryCodesRegenerated,
        entityId: userId,
      });
      return fresh;
    });
    if (!codes) {
      await this.throttle.recordFailure(key);
      throw new UnauthorizedException("Invalid verification code");
    }
    await this.throttle.clear(key);
    return { recoveryCodes: codes };
  }

  /** Administrative reset when a device is lost; the user enrols again. */
  async reset(userId: string, tx: Queryable) {
    await this.users.clearMfa(userId, tx);
    await this.recoveryCodes.deleteAll(userId, tx);
    await this.sessions.revokeAll(userId, tx);
  }

  private async acceptCode(
    userId: string,
    sealed: string,
    code: string,
    tx: Queryable,
  ) {
    const step = verifyTotp(this.secretOf(sealed), code);
    return step !== null && this.users.advanceMfaStep(userId, step, tx);
  }

  private async acceptRecoveryCode(
    userId: string,
    code: string,
    tx: Queryable,
  ) {
    const used = await this.recoveryCodes.consume(
      userId,
      hashRecoveryCode(code),
      tx,
    );
    if (used)
      await this.audit.record(tx, {
        actorId: userId,
        action: AuditAction.MfaRecoveryCodeUsed,
        entityId: userId,
      });
    return used;
  }

  private secretOf(sealed: string) {
    return base32Decode(open(sealed, this.config.mfaEncryptionKey));
  }
}
