import { Injectable } from "@nestjs/common";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { AuthenticatedUser } from "../auth/auth.types.js";
import { UserAdminResponse } from "./dto/user.response.js";
import { UserRole } from "./user-role.js";

export interface UserAuthSnapshot extends AuthenticatedUser {
  active: boolean;
  tokenVersion: number;
}

export interface UserCredentials {
  id: string;
  /** Null for members who only ever signed in with an emailed code. */
  passwordHash: string | null;
  active: boolean;
  tokenVersion: number;
  mfaEnabled: boolean;
}

export interface MfaState {
  email: string;
  mfaEnabled: boolean;
  mfaSecretEnc: string | null;
  mfaPendingSecretEnc: string | null;
}

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string | null;
  role: UserRole;
  facultyId: string | null;
  categoryId: string | null;
  passwordChangeRequired: boolean;
  emailVerified?: boolean;
}

export interface CodeSignInTarget {
  id: string;
  name: string | null;
  role: UserRole;
  active: boolean;
  tokenVersion: number;
  mfaEnabled: boolean;
}

export interface ProfileUpdate {
  name?: string;
  phone?: string;
  jobTitle?: string | null;
  facultyId?: string;
  categoryId?: string;
}

export interface RecoveryTarget {
  id: string;
  email: string;
  name: string;
  active: boolean;
}

export interface UserFilter {
  role?: UserRole;
  active?: boolean;
  facultyId?: string;
  search?: string;
}

const PUBLIC = `id, email, name, phone, job_title AS "jobTitle", role,
  faculty_id AS "facultyId", category_id AS "categoryId"`;
const PROFILE_COMPLETE = `(name IS NOT NULL AND phone IS NOT NULL AND faculty_id IS NOT NULL
  AND category_id IS NOT NULL)`;
const ADMIN_VIEW = `${PUBLIC}, active, password_change_required AS "passwordChangeRequired",
  mfa_enabled AS "mfaEnabled", email_verified_at IS NOT NULL AS "emailVerified", created_at AS "createdAt"`;

@Injectable()
export class UsersRepository {
  constructor(private readonly db: Database) {}

  async findAuthSnapshotById(id: string, tx: Queryable = this.db) {
    const { rows } = await tx.query<UserAuthSnapshot>(
      `SELECT ${PUBLIC}, active, token_version AS "tokenVersion",
              password_change_required AS "passwordChangeRequired", mfa_enabled AS "mfaEnabled",
              email_verified_at IS NOT NULL AS "emailVerified",
              ${PROFILE_COMPLETE} AS "profileComplete"
         FROM users WHERE id=$1`,
      [id],
    );
    return rows[0];
  }

  async findCredentialsByEmail(email: string) {
    const { rows } = await this.db.query<UserCredentials>(
      `SELECT id, password_hash AS "passwordHash", active, token_version AS "tokenVersion",
              mfa_enabled AS "mfaEnabled" FROM users WHERE email=$1`,
      [email],
    );
    return rows[0];
  }

  async findPasswordHash(id: string, tx: Queryable) {
    const { rows } = await tx.query<{ passwordHash: string }>(
      `SELECT password_hash AS "passwordHash" FROM users WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return rows[0]?.passwordHash;
  }

  async create(user: NewUser, tx: Queryable = this.db) {
    const { rows } = await tx.query<UserAdminResponse>(
      `INSERT INTO users(email,name,password_hash,role,faculty_id,category_id,password_change_required,email_verified_at)
       VALUES($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8 THEN now() END) RETURNING ${ADMIN_VIEW}`,
      [
        user.email,
        user.name,
        user.passwordHash,
        user.role,
        user.facultyId,
        user.categoryId,
        user.passwordChangeRequired,
        user.emailVerified ?? false,
      ],
    );
    return rows[0]!;
  }

  async findRecoveryTarget(email: string, tx: Queryable = this.db) {
    const { rows } = await tx.query<RecoveryTarget>(
      "SELECT id, email, name, active FROM users WHERE email=$1",
      [email],
    );
    return rows[0];
  }

  async findCodeSignInTarget(email: string, tx: Queryable = this.db) {
    const { rows } = await tx.query<CodeSignInTarget>(
      `SELECT id, name, role, active, token_version AS "tokenVersion", mfa_enabled AS "mfaEnabled"
         FROM users WHERE email=$1 FOR UPDATE`,
      [email],
    );
    return rows[0];
  }

  /** A member created by a successful sign-in code: verified, no password, no profile yet. */
  async createPasswordlessMember(email: string, tx: Queryable) {
    const { rows } = await tx.query<CodeSignInTarget>(
      `INSERT INTO users(email, email_verified_at) VALUES($1, now())
       RETURNING id, name, role, active, token_version AS "tokenVersion", mfa_enabled AS "mfaEnabled"`,
      [email],
    );
    return rows[0]!;
  }

  /** Writes only the fields given; returns the previous faculty and category. */
  async updateProfile(id: string, update: ProfileUpdate, tx: Queryable) {
    const { rows } = await tx.query<{
      previousFacultyId: string | null;
      previousCategoryId: string | null;
    }>(
      `UPDATE users u SET
          name = COALESCE($2, u.name),
          phone = COALESCE($3, u.phone),
          job_title = CASE WHEN $4::boolean THEN $5 ELSE u.job_title END,
          faculty_id = COALESCE($6, u.faculty_id),
          category_id = COALESCE($7, u.category_id)
        FROM (SELECT faculty_id, category_id FROM users WHERE id=$1) old
       WHERE u.id=$1
       RETURNING old.faculty_id AS "previousFacultyId", old.category_id AS "previousCategoryId"`,
      [
        id,
        update.name ?? null,
        update.phone ?? null,
        update.jobTitle !== undefined,
        update.jobTitle ?? null,
        update.facultyId ?? null,
        update.categoryId ?? null,
      ],
    );
    return rows[0]!;
  }

  async emailInUse(email: string, tx: Queryable) {
    const r = await tx.query(
      "SELECT 1 FROM users WHERE email=$1 OR pending_email=$1",
      [email],
    );
    return Boolean(r.rowCount);
  }

  async setPendingEmail(id: string, email: string, tx: Queryable) {
    await tx.query("UPDATE users SET pending_email=$2 WHERE id=$1", [
      id,
      email,
    ]);
  }

  /** Swaps in the confirmed address; returns the old one for the security notice. */
  async applyPendingEmail(id: string, tx: Queryable) {
    const { rows } = await tx.query<{
      oldEmail: string;
      newEmail: string | null;
      name: string | null;
    }>(
      `UPDATE users u SET email = old.pending_email, pending_email = NULL, email_verified_at = now()
         FROM (SELECT email, pending_email FROM users WHERE id=$1 FOR UPDATE) old
        WHERE u.id=$1 AND old.pending_email IS NOT NULL
        RETURNING old.email AS "oldEmail", u.email AS "newEmail", u.name`,
      [id],
    );
    return rows[0];
  }

  async markEmailVerified(id: string, tx: Queryable) {
    await tx.query(
      "UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id=$1",
      [id],
    );
  }

  async findAdminView(id: string, tx: Queryable = this.db) {
    const { rows } = await tx.query<UserAdminResponse>(
      `SELECT ${ADMIN_VIEW} FROM users WHERE id=$1`,
      [id],
    );
    return rows[0];
  }

  /** Locks one account for an administrative change. */
  async lockAdminView(id: string, tx: Queryable) {
    const { rows } = await tx.query<UserAdminResponse>(
      `SELECT ${ADMIN_VIEW} FROM users WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return rows[0];
  }

  /**
   * Locks every active admin so two concurrent demotions cannot both pass
   * the "at least one admin remains" check.
   */
  async lockActiveAdminIds(tx: Queryable) {
    const { rows } = await tx.query<{ id: string }>(
      "SELECT id FROM users WHERE role='ADMIN' AND active ORDER BY id FOR UPDATE",
    );
    return rows.map((row) => row.id);
  }

  async list(filter: UserFilter, page: PaginationQueryDto) {
    const where = `($1::text IS NULL OR role=$1) AND ($2::boolean IS NULL OR active=$2)
      AND ($3::uuid IS NULL OR faculty_id=$3)
      AND ($4::text IS NULL OR email ILIKE '%' || $4 || '%' OR name ILIKE '%' || $4 || '%')`;
    const params = [
      filter.role ?? null,
      filter.active ?? null,
      filter.facultyId ?? null,
      filter.search ? filter.search.replace(/[%_\\]/g, (c) => `\\${c}`) : null,
    ];
    const [items, count] = await Promise.all([
      this.db.query<UserAdminResponse>(
        `SELECT ${ADMIN_VIEW} FROM users WHERE ${where} ORDER BY created_at DESC LIMIT $5 OFFSET $6`,
        [...params, page.limit, page.offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM users WHERE ${where}`,
        params,
      ),
    ]);
    return { items: items.rows, total: count.rows[0]!.total };
  }

  async setRole(
    id: string,
    role: UserRole,
    facultyId: string | null,
    tx: Queryable,
  ) {
    const { rows } = await tx.query<UserAdminResponse>(
      `UPDATE users SET role=$2, faculty_id=$3 WHERE id=$1 RETURNING ${ADMIN_VIEW}`,
      [id, role, facultyId],
    );
    return rows[0]!;
  }

  async setActive(id: string, active: boolean, tx: Queryable) {
    const { rows } = await tx.query<UserAdminResponse>(
      `UPDATE users SET active=$2 WHERE id=$1 RETURNING ${ADMIN_VIEW}`,
      [id, active],
    );
    return rows[0]!;
  }

  async setPassword(
    id: string,
    passwordHash: string,
    changeRequired: boolean,
    tx: Queryable,
  ) {
    await tx.query(
      "UPDATE users SET password_hash=$2, password_change_required=$3 WHERE id=$1",
      [id, passwordHash, changeRequired],
    );
  }

  async incrementTokenVersion(id: string, tx: Queryable) {
    await tx.query(
      "UPDATE users SET token_version=token_version+1 WHERE id=$1",
      [id],
    );
  }

  // ---- second factor -------------------------------------------------------

  async findMfaState(id: string, tx: Queryable = this.db) {
    const { rows } = await tx.query<MfaState>(
      `SELECT email, mfa_enabled AS "mfaEnabled", mfa_secret_enc AS "mfaSecretEnc",
              mfa_pending_secret_enc AS "mfaPendingSecretEnc" FROM users WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return rows[0];
  }

  async setPendingMfaSecret(id: string, sealed: string, tx: Queryable) {
    await tx.query("UPDATE users SET mfa_pending_secret_enc=$2 WHERE id=$1", [
      id,
      sealed,
    ]);
  }

  async enableMfa(id: string, step: number, tx: Queryable) {
    await tx.query(
      `UPDATE users SET mfa_enabled=true, mfa_secret_enc=mfa_pending_secret_enc,
              mfa_pending_secret_enc=NULL, mfa_last_step=$2 WHERE id=$1`,
      [id, step],
    );
  }

  /** Atomically accepts a TOTP step only if it is newer than the last one. */
  async advanceMfaStep(id: string, step: number, tx: Queryable) {
    const result = await tx.query(
      "UPDATE users SET mfa_last_step=$2 WHERE id=$1 AND (mfa_last_step IS NULL OR mfa_last_step < $2)",
      [id, step],
    );
    return result.rowCount === 1;
  }

  async clearMfa(id: string, tx: Queryable) {
    await tx.query(
      `UPDATE users SET mfa_enabled=false, mfa_secret_enc=NULL,
              mfa_pending_secret_enc=NULL, mfa_last_step=NULL WHERE id=$1`,
      [id],
    );
  }

  // ---- bookings ------------------------------------------------------------

  /**
   * Row lock that serializes a user's booking writes.
   * Lock order for bookings: user → trip. Never take them in reverse.
   */
  async lockForUpdate(id: string, tx: Queryable) {
    await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]);
  }
}
