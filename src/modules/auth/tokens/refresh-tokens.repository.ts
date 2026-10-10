import { Injectable } from "@nestjs/common";
import { Queryable } from "../../../database/database.types.js";

export interface RefreshTokenRow {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  tokenVersion: number;
  expired: boolean;
  usedAt: Date | null;
  revokedAt: Date | null;
}

export interface NewRefreshToken {
  userId: string;
  familyId: string;
  tokenHash: string;
  tokenVersion: number;
  ttlSeconds: number;
}

@Injectable()
export class RefreshTokensRepository {
  /** Row lock: concurrent refreshes of one token serialize here. */
  async lockById(id: string, tx: Queryable) {
    const { rows } = await tx.query<RefreshTokenRow>(
      `SELECT id, user_id AS "userId", family_id AS "familyId", token_hash AS "tokenHash",
              token_version AS "tokenVersion", expires_at <= now() AS "expired",
              used_at AS "usedAt", revoked_at AS "revokedAt"
         FROM refresh_tokens WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return rows[0];
  }

  async insert(token: NewRefreshToken, tx: Queryable) {
    const { rows } = await tx.query<{ id: string }>(
      "INSERT INTO refresh_tokens(user_id,family_id,token_hash,token_version,expires_at) VALUES($1,$2,$3,$4,now() + make_interval(secs => $5)) RETURNING id",
      [
        token.userId,
        token.familyId,
        token.tokenHash,
        token.tokenVersion,
        token.ttlSeconds,
      ],
    );
    return rows[0]!.id;
  }

  async markUsed(id: string, tx: Queryable) {
    await tx.query("UPDATE refresh_tokens SET used_at=now() WHERE id=$1", [id]);
  }

  async revokeFamily(familyId: string, tx: Queryable) {
    await tx.query(
      "UPDATE refresh_tokens SET revoked_at=now() WHERE family_id=$1 AND revoked_at IS NULL",
      [familyId],
    );
  }

  async revokeAllForUser(userId: string, tx: Queryable) {
    await tx.query(
      "UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
      [userId],
    );
  }
}
