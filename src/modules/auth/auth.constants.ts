export const JWT_ISSUER = "bsu-bus-api";
export const JWT_AUDIENCE = "bsu-bus-client";
export const JWT_ALGORITHM = "HS256";
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** BL-01: failed logins allowed per email inside one window, across all instances. */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_FAILURE_WINDOW_SECONDS = 60;

/**
 * Per-IP limits on public auth routes. Kept well above one person's needs so
 * a campus NAT (many users, one IP) is not locked out; the per-email limit
 * above is what stops password guessing on an account.
 */
export const LOGIN_RATE_LIMIT = { default: { limit: 100, ttl: 60_000 } };
export const REGISTER_RATE_LIMIT = { default: { limit: 30, ttl: 60_000 } };
export const EMAIL_CODE_RATE_LIMIT = { default: { limit: 20, ttl: 60_000 } };
export const REFRESH_RATE_LIMIT = { default: { limit: 100, ttl: 60_000 } };

export const IS_PUBLIC_KEY = "auth:isPublic";
export const PERMISSIONS_KEY = "auth:permissions";
export const ALLOW_INCOMPLETE_ACCOUNT_KEY = "auth:allowIncompleteAccount";

/** Short-lived token proving the password step; only /auth/mfa/verify accepts it. */
export const MFA_TOKEN_AUDIENCE = "bsu-bus-mfa";
export const MFA_TOKEN_TTL_SECONDS = 5 * 60;
export const MFA_ISSUER_LABEL = "BSU Bus";
export const MFA_VERIFY_RATE_LIMIT = { default: { limit: 30, ttl: 60_000 } };
