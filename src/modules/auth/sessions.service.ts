import { Injectable } from "@nestjs/common";
import { Queryable } from "../../database/database.types.js";
import { UsersRepository } from "../users/users.repository.js";
import { RefreshTokensRepository } from "./tokens/refresh-tokens.repository.js";

/** Ends every session of a user: access tokens via version, refresh tokens by revocation. */
@Injectable()
export class SessionsService {
  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
  ) {}

  async revokeAll(userId: string, tx: Queryable) {
    await this.users.incrementTokenVersion(userId, tx);
    await this.refreshTokens.revokeAllForUser(userId, tx);
  }
}
