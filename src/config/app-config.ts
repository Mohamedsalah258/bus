import "dotenv/config";

export interface MailConfig {
  /** `disabled` keeps notifications queued; allowed outside production only. */
  readonly transport: "smtp" | "disabled";
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user?: string;
  readonly password?: string;
  readonly from: string;
  /** How often the dispatcher polls the outbox; 0 turns the poller off. */
  readonly pollIntervalMs: number;
}

export interface AppConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly jwtSecret: string;
  readonly corsOrigins: readonly string[];
  readonly swaggerEnabled: boolean;
  /** Number of trusted reverse-proxy hops in front of the API (0 = none). */
  readonly trustProxyHops: number;
  /** 32-byte key that encrypts TOTP secrets at rest. */
  readonly mfaEncryptionKey: Buffer;
  readonly mail: MailConfig;
  /** When set, registration accepts only these email domains. */
  readonly allowedEmailDomains: readonly string[];
}

/** Injection token for the validated application configuration. */
export const APP_CONFIG = Symbol("APP_CONFIG");

/**
 * Reads and validates configuration once at startup.
 * Fails fast with a message that never echoes secret values.
 */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const jwtSecret = env.JWT_SECRET ?? "";
  if (jwtSecret.length < 32 || /REPLACE_WITH/i.test(jwtSecret))
    throw new Error("JWT_SECRET must contain at least 32 random characters.");

  const databaseUrl = env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535.");

  const corsOrigins = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    if (origin === "*" || new URL(origin).origin !== origin)
      throw new Error("CORS_ORIGINS must list exact origins.");
  }

  const trustProxyHops = Number(env.TRUST_PROXY_HOPS ?? 0);
  if (
    !Number.isInteger(trustProxyHops) ||
    trustProxyHops < 0 ||
    trustProxyHops > 5
  )
    throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 5.");

  const mfaEncryptionKey = Buffer.from(env.MFA_ENCRYPTION_KEY ?? "", "base64");
  if (mfaEncryptionKey.length !== 32)
    throw new Error(
      "MFA_ENCRYPTION_KEY must be 32 random bytes, base64-encoded.",
    );

  const mail = readMailConfig(env);

  const allowedEmailDomains = (env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  for (const domain of allowedEmailDomains)
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain))
      throw new Error(
        "ALLOWED_EMAIL_DOMAINS must list domains like bsu.edu.eg.",
      );

  if (env.NODE_ENV === "production" && env.SWAGGER_ENABLED === "true")
    throw new Error("Public Swagger must be disabled in production.");

  return {
    port,
    databaseUrl,
    jwtSecret,
    corsOrigins,
    swaggerEnabled: env.SWAGGER_ENABLED === "true",
    trustProxyHops,
    mfaEncryptionKey,
    mail,
    allowedEmailDomains,
  };
}

function readMailConfig(env: NodeJS.ProcessEnv): MailConfig {
  const transport = (env.MAIL_TRANSPORT ??
    "disabled") as MailConfig["transport"];
  if (transport !== "smtp" && transport !== "disabled")
    throw new Error("MAIL_TRANSPORT must be smtp or disabled.");
  if (env.NODE_ENV === "production" && transport !== "smtp")
    throw new Error(
      "Production requires MAIL_TRANSPORT=smtp: verification codes are emailed.",
    );
  const pollIntervalMs = Number(env.MAIL_POLL_INTERVAL_MS ?? 5000);
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0)
    throw new Error("MAIL_POLL_INTERVAL_MS must be a non-negative integer.");
  const port = Number(env.SMTP_PORT ?? 587);
  const from = env.MAIL_FROM ?? "";
  if (transport === "smtp") {
    if (!env.SMTP_HOST)
      throw new Error("SMTP_HOST is required for MAIL_TRANSPORT=smtp.");
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("SMTP_PORT must be between 1 and 65535.");
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(from.replace(/^.*<(.+)>$/, "$1")))
      throw new Error(
        "MAIL_FROM must be an email address, optionally with a display name.",
      );
  }
  return {
    transport,
    host: env.SMTP_HOST ?? "",
    port,
    secure: env.SMTP_SECURE === "true",
    user: env.SMTP_USER || undefined,
    password: env.SMTP_PASSWORD || undefined,
    from,
    pollIntervalMs,
  };
}
