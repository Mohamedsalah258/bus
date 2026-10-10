import nodemailer, { Transporter } from "nodemailer";
import { MailConfig } from "../../config/app-config.js";
import { Mailer } from "./mailer.js";
import { RenderedEmail } from "./notification-template.js";

export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(private readonly config: MailConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user
        ? { user: config.user, pass: config.password ?? "" }
        : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(to: string, email: RenderedEmail) {
    await this.transporter.sendMail({
      from: this.config.from,
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }
}

/** Used when MAIL_TRANSPORT=disabled; the dispatcher never calls it. */
export class DisabledMailer implements Mailer {
  async send(): Promise<void> {
    throw new Error("Mail transport is disabled");
  }
}
