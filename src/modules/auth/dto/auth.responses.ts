import { ApiProperty } from "@nestjs/swagger";
import { UserResponse } from "../../users/dto/user.response.js";

export class TokenPairResponse {
  @ApiProperty() accessToken!: string;

  @ApiProperty({
    description:
      "Single-use. Each refresh returns a new one; replaying a used token revokes the whole session.",
  })
  refreshToken!: string;

  @ApiProperty({ example: "Bearer" }) tokenType!: "Bearer";

  @ApiProperty({ description: "Access token lifetime in seconds." })
  expiresIn!: number;

  @ApiProperty({ description: "Refresh token lifetime in seconds." })
  refreshExpiresIn!: number;
}

export class RegisterResponse {
  @ApiProperty({ type: UserResponse }) user!: UserResponse;
  @ApiProperty() message!: string;
}

/** Login answer when the password was right but a second factor is due. */
export class MfaChallengeResponse {
  @ApiProperty({ example: true }) mfaRequired!: true;

  @ApiProperty({ description: "Send to POST /auth/mfa/verify with the code." })
  mfaToken!: string;

  @ApiProperty() mfaTokenExpiresIn!: number;
}

export class MfaSetupResponse {
  @ApiProperty({ description: "Base32 secret, for manual entry." })
  secret!: string;

  @ApiProperty({ description: "Render as a QR code for authenticator apps." })
  otpauthUrl!: string;
}

export class MfaActivatedResponse {
  @ApiProperty({
    type: [String],
    description:
      "Shown once. Each works one time if the device is lost. All sessions were ended: log in again.",
  })
  recoveryCodes!: string[];
}
