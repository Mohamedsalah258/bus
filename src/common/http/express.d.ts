import type { AuthenticatedUser } from "../../modules/auth/auth.types.js";

declare module "express-serve-static-core" {
  interface Request {
    /** Correlation id set by `requestIdMiddleware`; echoed as `X-Request-Id`. */
    id?: string;
    /** Set by `AuthGuard` once the bearer token is verified. */
    user?: AuthenticatedUser;
  }
}
