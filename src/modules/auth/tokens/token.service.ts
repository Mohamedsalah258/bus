import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { Queryable } from "../../../database/database.types.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "../auth.constants.js";
import { AccessTokenClaims } from "../auth.types.js";
import { TokenPairResponse } from "../dto/auth.responses.js";
import { formatRefreshToken, newRefreshSecret } from "./refresh-token.js";
import { RefreshTokensRepository } from "./refresh-tokens.repository.js";

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokensRepository,
  ) {}

  /**
   * Issues an access token and a refresh token. `familyId` is omitted on
   * login (a new session) and carried over on rotation.
   */
  async issuePair(
    user: { id: string; tokenVersion: number },
    tx: Queryable,
    familyId: string = randomUUID(),
  ): Promise<TokenPairResponse> {
    const { secret, hash } = newRefreshSecret();
    const id = await this.refreshTokens.insert(
      {
        userId: user.id,
        familyId,
        tokenHash: hash,
        tokenVersion: user.tokenVersion,
        ttlSeconds: REFRESH_TOKEN_TTL_SECONDS,
      },
      tx,
    );
    const claims: AccessTokenClaims = { sub: user.id, ver: user.tokenVersion };
    return {
      accessToken: await this.jwt.signAsync(claims),
      refreshToken: formatRefreshToken(id, secret),
      tokenType: "Bearer",
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
    };
  }
}
