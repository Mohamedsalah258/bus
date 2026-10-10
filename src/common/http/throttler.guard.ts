import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { createHash } from "node:crypto";
import { IS_PUBLIC_KEY } from "../../modules/auth/auth.constants.js";

const TRACK_BY_IP = Symbol("throttle:trackByIp");

/**
 * Rate-limits protected routes per bearer token rather than per IP, so
 * hundreds of users behind one campus NAT do not share a single bucket.
 *
 * Public routes (login, register, refresh) are ALWAYS tracked by IP: there an
 * attacker controls the Authorization header and could mint a fresh bucket
 * per request. A forged token on a protected route only buys a cheap 401.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    req[TRACK_BY_IP] =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    return super.canActivate(context);
  }

  protected override async getTracker(req: Record<string | symbol, any>) {
    const header: unknown = req.headers?.authorization;
    if (
      !req[TRACK_BY_IP] &&
      typeof header === "string" &&
      header.startsWith("Bearer ")
    )
      return (
        "token:" +
        createHash("sha256").update(header.slice(7)).digest("hex").slice(0, 32)
      );
    return `ip:${req.ip}`;
  }
}
