import { RenderedEmail } from "./notification-template.js";

/** Injection token for the outbound mail transport. */
export const MAILER = Symbol("MAILER");

export interface Mailer {
  send(to: string, email: RenderedEmail): Promise<void>;
}
