import { Injectable } from "@nestjs/common";
import { Queryable } from "../../../database/database.types.js";

@Injectable()
export class RecoveryCodesRepository {
  async replaceAll(userId: string, hashes: string[], tx: Queryable) {
    await this.deleteAll(userId, tx);
    for (const hash of hashes)
      await tx.query(
        "INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)",
        [userId, hash],
      );
  }

  /** Single use: true only for the first caller that presents the code. */
  async consume(userId: string, hash: string, tx: Queryable) {
    const result = await tx.query(
      "UPDATE mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL",
      [userId, hash],
    );
    return result.rowCount === 1;
  }

  async deleteAll(userId: string, tx: Queryable) {
    await tx.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [userId]);
  }
}
