import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../../../config/app-config.js";
import { Queryable } from "../../../database/database.types.js";
import { NotificationTemplate } from "../../notifications/notification-template.js";
import { NotificationsService } from "../../notifications/notifications.service.js";
import {
  deriveEmailOtpKey,
  EMAIL_OTP_MAX_PER_HOUR,
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
  EMAIL_OTP_TTL_MINUTES,
  EmailOtpPurpose,
  emailOtpMatches,
  generateEmailOtp,
  hashEmailOtp,
  OtpSubject,
  subjectKey,
} from "./email-otp.js";
import { EmailOtpsRepository } from "./email-otps.repository.js";

const TEMPLATE = {
  [EmailOtpPurpose.VerifyEmail]: NotificationTemplate.VerifyEmail,
  [EmailOtpPurpose.ResetPassword]: NotificationTemplate.ResetPassword,
  [EmailOtpPurpose.SignIn]: NotificationTemplate.SignInCode,
  [EmailOtpPurpose.ChangeEmail]: NotificationTemplate.VerifyEmail,
} as const;

export interface OtpRecipient {
  /** Absent for a sign-in code to an email without an account yet. */
  id?: string;
  email: string;
  name: string | null;
}

/** Issues and checks one-time codes sent by email (decision D3). */
@Injectable()
export class EmailOtpService {
  private readonly key: Buffer;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly otps: EmailOtpsRepository,
    private readonly notifications: NotificationsService,
  ) {
    // Rotating JWT_SECRET also voids codes in flight; they live 10 minutes.
    this.key = deriveEmailOtpKey(config.jwtSecret);
  }

  /**
   * Creates a code and queues the email in the caller's transaction.
   * `enforceLimits` applies the resend cooldown and hourly cap.
   */
  async issue(
    recipient: OtpRecipient,
    purpose: EmailOtpPurpose,
    tx: Queryable,
    { enforceLimits }: { enforceLimits: boolean },
  ) {
    const subject = this.subjectOf(recipient, purpose);
    if (enforceLimits) {
      const recent = await this.otps.recentIssues(subject, purpose, tx);
      if (
        recent.lastHour >= EMAIL_OTP_MAX_PER_HOUR ||
        (recent.secondsSinceLast !== null &&
          recent.secondsSinceLast < EMAIL_OTP_RESEND_COOLDOWN_SECONDS)
      )
        throw new HttpException(
          "A code was sent recently. Wait a minute before requesting another.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
    }
    const code = generateEmailOtp();
    await this.otps.issue(
      subject,
      purpose,
      this.hash(subject, purpose, code),
      tx,
    );
    await this.notifications.send(
      tx,
      { userId: recipient.id ?? null, email: recipient.email },
      TEMPLATE[purpose],
      { name: recipient.name ?? "", code, minutes: EMAIL_OTP_TTL_MINUTES },
      { sensitive: true },
    );
  }

  /**
   * True once for the right code. A wrong code costs one of five attempts;
   * after that, or after ten minutes, a new code is needed. Callers must
   * commit even on false, so the attempt is counted.
   */
  async consume(
    subject: OtpSubject,
    purpose: EmailOtpPurpose,
    code: string,
    tx: Queryable,
  ) {
    const otp = await this.otps.lockActive(subject, purpose, tx);
    if (!otp) return false;
    if (!emailOtpMatches(otp.codeHash, this.hash(subject, purpose, code))) {
      await this.otps.recordWrongAttempt(otp.id, tx);
      return false;
    }
    await this.otps.consume(otp.id, tx);
    return true;
  }

  /** Sign-in codes belong to the email; all others to the account. */
  private subjectOf(r: OtpRecipient, purpose: EmailOtpPurpose): OtpSubject {
    if (purpose === EmailOtpPurpose.SignIn) return { email: r.email };
    if (!r.id) throw new Error("This code purpose needs an account");
    return { userId: r.id };
  }

  private hash(subject: OtpSubject, purpose: EmailOtpPurpose, code: string) {
    return hashEmailOtp(this.key, subjectKey(subject), purpose, code);
  }
}
