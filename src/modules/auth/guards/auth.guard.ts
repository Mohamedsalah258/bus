import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { MFA_REQUIRED_ROLES } from "../../users/user-role.js";
import { UsersRepository } from "../../users/users.repository.js";
import {
  ALLOW_INCOMPLETE_ACCOUNT_KEY,
  IS_PUBLIC_KEY,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  PERMISSIONS_KEY,
} from "../auth.constants.js";
import { AccessTokenClaims, AuthenticatedUser } from "../auth.types.js";
import { hasPermissions, Permission } from "../permissions.js";

const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

/**
 * Global guard. Verifies the bearer token, then re-reads role, active flag,
 * token version and account state from the database on every request, so
 * revocation, role changes and lockouts apply immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersRepository,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
      return true;

    const request = ctx.switchToHttp().getRequest();
    const claims = await this.verifyBearer(request.headers.authorization);

    const snapshot = await this.users.findAuthSnapshotById(claims.sub);
    if (!snapshot?.active || snapshot.tokenVersion !== claims.ver)
      throw new UnauthorizedException();
    const { active: _active, tokenVersion: _version, ...user } = snapshot;
    request.user = user satisfies AuthenticatedUser;

    if (
      !this.reflector.getAllAndOverride<boolean>(
        ALLOW_INCOMPLETE_ACCOUNT_KEY,
        targets,
      )
    ) {
      if (!user.emailVerified)
        throw new ForbiddenException(
          "Email verification required: enter the code sent to your email",
        );
      if (user.passwordChangeRequired)
        throw new ForbiddenException(
          "Password change required before continuing",
        );
      if (MFA_REQUIRED_ROLES.includes(user.role) && !user.mfaEnabled)
        throw new ForbiddenException(
          "Two-factor authentication must be set up for this role",
        );
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      targets,
    );
    if (required && !hasPermissions(user.role, required))
      throw new ForbiddenException();
    return true;
  }

  private async verifyBearer(header: string | undefined) {
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException();
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(header.slice(7), {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
    if (
      typeof claims.sub !== "string" ||
      !UUID_PATTERN.test(claims.sub) ||
      !Number.isInteger(claims.ver)
    )
      throw new UnauthorizedException();
    return claims;
  }
}
