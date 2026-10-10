import { Body, Controller, Get, HttpCode, Patch, Post } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  getSchemaPath,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { MeResponse } from "../users/dto/user.response.js";
import { MFA_REQUIRED_ROLES } from "../users/user-role.js";
import {
  EMAIL_CODE_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  MFA_VERIFY_RATE_LIMIT,
  REFRESH_RATE_LIMIT,
  REGISTER_RATE_LIMIT,
} from "./auth.constants.js";
import { AuthService } from "./auth.service.js";
import { AuthenticatedUser } from "./auth.types.js";
import { AllowIncompleteAccount } from "./decorators/allow-incomplete-account.decorator.js";
import { CurrentUser } from "./decorators/current-user.decorator.js";
import { Public } from "./decorators/public.decorator.js";
import {
  MfaActivatedResponse,
  MfaChallengeResponse,
  MfaSetupResponse,
  RegisterResponse,
  TokenPairResponse,
} from "./dto/auth.responses.js";
import {
  AcceptedResponse,
  EmailCodeDto,
  ForgotPasswordDto,
  ResetPasswordWithCodeDto,
  SignInCodeRequestDto,
  SignInCodeVerifyDto,
} from "./dto/email-otp.dto.js";
import { UpdateProfileDto } from "./dto/profile.dto.js";
import {
  EmailChangeConfirmDto,
  EmailChangeRequestDto,
} from "./dto/email-change.dto.js";
import { LoginDto } from "./dto/login.dto.js";
import { ChangePasswordDto, MfaCodeDto, MfaVerifyDto } from "./dto/mfa.dto.js";
import { RefreshDto } from "./dto/refresh.dto.js";
import { RegisterDto } from "./dto/register.dto.js";
import { MfaService } from "./mfa/mfa.service.js";

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Public()
  @Throttle(REGISTER_RATE_LIMIT)
  @Post("register")
  @ApiCreatedResponse({ type: RegisterResponse })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  /**
   * Returns tokens, or `{ mfaRequired: true, mfaToken }` when the account has
   * a second factor. 429 after 5 failed attempts for one email within a minute.
   */
  @Public()
  @Throttle(LOGIN_RATE_LIMIT)
  @Post("login")
  @HttpCode(200)
  @ApiExtraModels(TokenPairResponse, MfaChallengeResponse)
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(TokenPairResponse) },
        { $ref: getSchemaPath(MfaChallengeResponse) },
      ],
    },
  })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /**
   * Password-free sign-in, step 1: emails a 6-digit code. Same answer for
   * new and existing emails. Members only; staff use password + MFA.
   */
  @Public()
  @Throttle(EMAIL_CODE_RATE_LIMIT)
  @Post("code/request")
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedResponse })
  requestCode(@Body() dto: SignInCodeRequestDto) {
    return this.auth.requestSignInCode(dto.email);
  }

  /**
   * Step 2: the code signs the member in. The first time, the account is
   * created; the profile is completed by the subscription form.
   */
  @Public()
  @Throttle(EMAIL_CODE_RATE_LIMIT)
  @Post("code/verify")
  @HttpCode(200)
  @ApiExtraModels(TokenPairResponse, MfaChallengeResponse)
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(TokenPairResponse) },
        { $ref: getSchemaPath(MfaChallengeResponse) },
      ],
    },
  })
  verifyCode(@Body() dto: SignInCodeVerifyDto) {
    return this.auth.verifySignInCode(dto.email, dto.code);
  }

  /** Second login step. 429 after 5 wrong codes within a minute. */
  @Public()
  @Throttle(MFA_VERIFY_RATE_LIMIT)
  @Post("mfa/verify")
  @HttpCode(200)
  @ApiOkResponse({ type: TokenPairResponse })
  verifyMfa(@Body() dto: MfaVerifyDto) {
    return this.mfa.verify(dto);
  }

  @Public()
  @Throttle(REFRESH_RATE_LIMIT)
  @Post("refresh")
  @HttpCode(200)
  @ApiOkResponse({ type: TokenPairResponse })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @AllowIncompleteAccount()
  @Get("me")
  @ApiOkResponse({ type: MeResponse })
  me(@CurrentUser() user: AuthenticatedUser): MeResponse {
    return { ...user, mfaRequired: MFA_REQUIRED_ROLES.includes(user.role) };
  }

  /** Name, phone, job title; members also faculty and category. */
  @ApiBearerAuth()
  @AllowIncompleteAccount()
  @Patch("me/profile")
  @ApiOkResponse({ type: MeResponse })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<MeResponse> {
    const updated = await this.auth.updateProfile(user, dto);
    const { active: _a, tokenVersion: _t, ...me } = updated;
    return { ...me, mfaRequired: MFA_REQUIRED_ROLES.includes(me.role) };
  }

  /** Ends every other session and returns a fresh token pair. */
  @ApiBearerAuth()
  @AllowIncompleteAccount()
  @Post("password")
  @HttpCode(200)
  @ApiOkResponse({ type: TokenPairResponse })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user, dto);
  }

  /** Step 1 of two-factor enrolment: returns the secret to scan. */
  @ApiBearerAuth()
  @AllowIncompleteAccount()
  @Post("mfa/setup")
  @HttpCode(200)
  @ApiOkResponse({ type: MfaSetupResponse })
  setupMfa(@CurrentUser() user: AuthenticatedUser) {
    return this.mfa.setup(user);
  }

  /** Step 2: confirm with a code. Returns recovery codes once and ends all sessions. */
  @ApiBearerAuth()
  @AllowIncompleteAccount()
  @Post("mfa/activate")
  @HttpCode(200)
  @ApiOkResponse({ type: MfaActivatedResponse })
  activateMfa(@CurrentUser() user: AuthenticatedUser, @Body() dto: MfaCodeDto) {
    return this.mfa.activate(user.id, dto.code);
  }

  /** Ends every session of the user: all access and refresh tokens. */
  @ApiBearerAuth()
  @AllowIncompleteAccount()
  @Post("logout")
  @HttpCode(204)
  @ApiNoContentResponse()
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.auth.logout(user.id);
  }

  /** Confirms the email with the 6-digit code it received (10 minutes, 5 tries). */
  @ApiBearerAuth()
  @AllowIncompleteAccount()
  @Post("email/verify")
  @HttpCode(204)
  @ApiNoContentResponse()
  async verifyEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EmailCodeDto,
  ) {
    await this.auth.verifyEmail(user.id, dto.code);
  }

  /** New verification code; at most one a minute and five an hour. */
  @ApiBearerAuth()
  @AllowIncompleteAccount()
  @Post("email/resend")
  @HttpCode(204)
  @ApiNoContentResponse()
  async resendVerification(@CurrentUser() user: AuthenticatedUser) {
    await this.auth.resendVerification(user);
  }

  /** Emails a reset code. The answer never reveals whether the account exists. */
  @Public()
  @Throttle(EMAIL_CODE_RATE_LIMIT)
  @Post("password/forgot")
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedResponse })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  /** Sets a new password with the emailed code and ends every session. */
  @Public()
  @Throttle(EMAIL_CODE_RATE_LIMIT)
  @Post("password/reset")
  @HttpCode(204)
  @ApiNoContentResponse()
  async resetPassword(@Body() dto: ResetPasswordWithCodeDto) {
    await this.auth.resetPasswordWithCode(dto);
  }

  /** BL-33 step 1: a code goes to the new address; at most one a minute. */
  @ApiBearerAuth()
  @Post("email/change")
  @HttpCode(204)
  @ApiNoContentResponse()
  async requestEmailChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EmailChangeRequestDto,
  ) {
    await this.auth.requestEmailChange(user, dto.newEmail);
  }

  /** Step 2: the code switches the sign-in email; the old address is warned. */
  @ApiBearerAuth()
  @Post("email/change/confirm")
  @HttpCode(204)
  @ApiNoContentResponse()
  async confirmEmailChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EmailChangeConfirmDto,
  ) {
    await this.auth.confirmEmailChange(user, dto.code);
  }

  /** BL-35: replaces all recovery codes; needs a current authenticator code. */
  @ApiBearerAuth()
  @Post("mfa/recovery-codes")
  @HttpCode(200)
  @ApiOkResponse({ type: MfaActivatedResponse })
  regenerateRecoveryCodes(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaCodeDto,
  ) {
    return this.mfa.regenerateRecoveryCodes(user.id, dto.code);
  }
}
