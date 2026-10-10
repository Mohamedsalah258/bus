import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import assert from "node:assert/strict";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/app.setup.js";
import { Database } from "../../src/database/database.service.js";
import { Mailer, MAILER } from "../../src/modules/notifications/mailer.js";
import { RenderedEmail } from "../../src/modules/notifications/notification-template.js";
import { hashPassword } from "../../src/modules/auth/password.js";
import {
  base32Decode,
  currentStep,
  totpAt,
} from "../../src/modules/auth/mfa/totp.js";
import { createPgliteDatabase, useTestEnvironment } from "./pglite-database.js";

export const ADMIN = {
  email: "admin@test.example",
  password: "admin test password",
};

/** A valid authenticator code for `secret`, as a phone app would show it. */
export const totp = (secret: string, offsetSteps = 0) =>
  totpAt(base32Decode(secret), currentStep() + offsetSteps);

/** Records every email instead of sending it; can be told to fail. */
export class FakeMailer implements Mailer {
  readonly sent: Array<{ to: string; email: RenderedEmail }> = [];
  failWith?: Error;
  async send(to: string, email: RenderedEmail) {
    if (this.failWith) throw this.failWith;
    this.sent.push({ to, email });
  }
}

/** Full HTTP app on an in-memory PostgreSQL, with one seeded admin. */
export async function createTestApp(options: { mailer?: Mailer } = {}) {
  useTestEnvironment();
  const { database, close } = await createPgliteDatabase();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Database)
    .useValue(database);
  if (options.mailer)
    builder = builder.overrideProvider(MAILER).useValue(options.mailer);
  const module = await builder.compile();
  const app: INestApplication = module.createNestApplication({
    logger: false,
  });
  configureApp(app);
  await app.init();
  const api = request(app.getHttpServer());

  await database.query(
    "INSERT INTO users(email,name,password_hash,role,email_verified_at) VALUES($1,'Admin',$2,'ADMIN',now())",
    [ADMIN.email, await hashPassword(ADMIN.password)],
  );

  const login = async (email: string, password: string) =>
    (await api.post("/api/v1/auth/login").send({ email, password }).expect(200))
      .body;
  const bearer = async (email: string, password: string) => {
    const body = await login(email, password);
    assert.ok(body.accessToken, "account has MFA; use mfaBearer");
    return "Bearer " + body.accessToken;
  };

  /** Enrols a second factor through the API; returns the secret and codes. */
  const enrollMfa = async (authorization: string) => {
    const setup = (
      await api
        .post("/api/v1/auth/mfa/setup")
        .set("Authorization", authorization)
        .expect(200)
    ).body;
    const activated = (
      await api
        .post("/api/v1/auth/mfa/activate")
        .set("Authorization", authorization)
        .send({ code: totp(setup.secret) })
        .expect(200)
    ).body;
    return {
      secret: setup.secret as string,
      recoveryCodes: activated.recoveryCodes as string[],
    };
  };

  /**
   * Password + TOTP login. A real code works once per 30 s window, so tests
   * that log in repeatedly clear the replay marker first (test-only shortcut).
   */
  const mfaBearer = async (email: string, password: string, secret: string) => {
    await database.query("UPDATE users SET mfa_last_step=NULL WHERE email=$1", [
      email,
    ]);
    const challenge = await login(email, password);
    assert.equal(challenge.mfaRequired, true);
    const tokens = (
      await api
        .post("/api/v1/auth/mfa/verify")
        .send({ mfaToken: challenge.mfaToken, code: totp(secret) })
        .expect(200)
    ).body;
    return "Bearer " + tokens.accessToken;
  };

  let adminSecret: string | undefined;
  const adminBearer = async () => {
    adminSecret ??= (await enrollMfa(await bearer(ADMIN.email, ADMIN.password)))
      .secret;
    return mfaBearer(ADMIN.email, ADMIN.password, adminSecret);
  };

  /** The latest code emailed to `email`, read from the outbox as an inbox would show it. */
  const emailCode = async (email: string, template = "VERIFY_EMAIL") => {
    const { rows } = await database.query(
      "SELECT payload->>'code' AS code FROM notifications WHERE to_email=$1 AND template=$2 ORDER BY created_at DESC LIMIT 1",
      [email, template],
    );
    assert.ok(rows[0]?.code, `no ${template} code queued for ${email}`);
    return rows[0].code as string;
  };

  const verifyEmail = async (authorization: string, email: string) => {
    const code = await emailCode(email);
    await api
      .post("/api/v1/auth/email/verify")
      .set("Authorization", authorization)
      .send({ code })
      .expect(204);
  };

  /** Public registration + email verification; returns a bearer header. */
  const registerMember = async (input: {
    email: string;
    facultyId: string;
    categoryId: string;
    password?: string;
    name?: string;
  }) => {
    const password = input.password ?? "member test password";
    await api
      .post("/api/v1/auth/register")
      .send({
        email: input.email,
        password,
        name: input.name ?? "Member " + input.email.split("@")[0],
        facultyId: input.facultyId,
        categoryId: input.categoryId,
      })
      .expect(201);
    const token = await bearer(input.email, password);
    await verifyEmail(token, input.email);
    // A subscription request needs a complete profile, phone included.
    await api
      .patch("/api/v1/auth/me/profile")
      .set("Authorization", token)
      .send({ phone: "01012345678" })
      .expect(200);
    return token;
  };

  const createPlan = async (
    seasonId: string,
    plan: Partial<{
      name: string;
      period: string;
      startsOn: string;
      endsOn: string;
      feeMinor: number;
    }> = {},
  ) => {
    const admin = await adminBearer();
    return (
      await api
        .post("/api/v1/plans")
        .set("Authorization", admin)
        .send({
          seasonId,
          name: "Annual plan",
          period: "ANNUAL",
          startsOn: "2000-01-01",
          endsOn: "2099-12-31",
          feeMinor: 0,
          ...plan,
        })
        .expect(201)
    ).body as { id: string; feeMinor: number };
  };

  const createCategory = async (code: string, name: string) => {
    // Resolve the token first: a supertest request must not wait on others.
    const admin = await adminBearer();
    return (
      await api
        .post("/api/v1/categories")
        .set("Authorization", admin)
        .send({ code, name })
        .expect(201)
    ).body as { id: string; code: string };
  };

  return {
    app,
    api,
    database,
    login,
    bearer,
    enrollMfa,
    mfaBearer,
    adminBearer,
    createCategory,
    createPlan,
    emailCode,
    verifyEmail,
    registerMember,
    close: async () => {
      await app.close();
      await close();
    },
  };
}

/** Recursively lists object keys that are not camelCase. */
export function nonCamelKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value))
    return value.flatMap((v, i) => nonCamelKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => [
      ...(/^[a-z][a-zA-Z0-9]*$/.test(k) ? [] : [`${path}.${k}`]),
      ...nonCamelKeys(v, `${path}.${k}`),
    ]);
  return [];
}
