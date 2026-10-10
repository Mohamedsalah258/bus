/** Every email the system sends. Arabic first, right to left. */
export const NotificationTemplate = {
  VerifyEmail: "VERIFY_EMAIL",
  ResetPassword: "RESET_PASSWORD",
  SignInCode: "SIGN_IN_CODE",
  EmailChanged: "EMAIL_CHANGED",
  SubscriptionStatusChanged: "SUBSCRIPTION_STATUS_CHANGED",
  SubscriptionPaymentRecorded: "SUBSCRIPTION_PAYMENT_RECORDED",
  SubscriptionRefundRecorded: "SUBSCRIPTION_REFUND_RECORDED",
  BookingConfirmed: "BOOKING_CONFIRMED",
  BookingCancelled: "BOOKING_CANCELLED",
  BookingCancelledByAdmin: "BOOKING_CANCELLED_BY_ADMIN",
  ComplaintUpdated: "COMPLAINT_UPDATED",
  GroupTripUpdated: "GROUP_TRIP_UPDATED",
} as const;

export type NotificationTemplate =
  (typeof NotificationTemplate)[keyof typeof NotificationTemplate];

/** Trip facts every booking email repeats, captured when queued. */
export interface BookingFacts {
  name: string;
  routeName: string;
  boardingStopName: string;
  direction: string;
  departureAt: string;
}

export interface TemplatePayloads {
  VERIFY_EMAIL: { name: string; code: string; minutes: number };
  RESET_PASSWORD: { name: string; code: string; minutes: number };
  SIGN_IN_CODE: { name: string; code: string; minutes: number };
  EMAIL_CHANGED: { name: string; newEmailMasked: string };
  SUBSCRIPTION_STATUS_CHANGED: {
    name: string;
    routeName: string;
    planName: string;
    status: string;
    reason: string;
  };
  SUBSCRIPTION_PAYMENT_RECORDED: {
    name: string;
    routeName: string;
    planName: string;
    amountMinor: number;
    paidInFull: boolean;
  };
  SUBSCRIPTION_REFUND_RECORDED: {
    name: string;
    routeName: string;
    planName: string;
    amountMinor: number;
  };
  BOOKING_CONFIRMED: BookingFacts;
  BOOKING_CANCELLED: BookingFacts;
  BOOKING_CANCELLED_BY_ADMIN: BookingFacts & { reason: string };
  COMPLAINT_UPDATED: {
    name: string;
    reference: string;
    subject: string;
    event: "RECEIVED" | "REPLIED" | "RESOLVED" | "CLOSED";
    message: string | null;
  };
  GROUP_TRIP_UPDATED: {
    name: string;
    reference: string;
    destination: string;
    departureAt: string;
    event: "RECEIVED" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "CANCELLED";
    reason: string | null;
    buses: Array<{
      plate: string;
      driverName: string;
      driverPhone: string | null;
    }>;
  };
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const STATUS_AR: Record<string, string> = {
  APPROVED: "تمت الموافقة على طلب اشتراكك",
  REJECTED: "تم رفض طلب اشتراكك",
  NEEDS_INFO: "طلب اشتراكك يحتاج استكمال بيانات",
  SUSPENDED: "تم إيقاف اشتراكك مؤقتًا",
  REINSTATED: "تمت إعادة تفعيل اشتراكك",
};

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

const egp = (minor: number) => `${(minor / 100).toFixed(2)} جنيه`;

/** Cairo wall-clock time in Arabic, e.g. «الأحد، 11 أكتوبر 2026 في 7:00 ص». */
export const cairoTime = (iso: string) =>
  new Intl.DateTimeFormat("ar-EG", {
    timeZone: "Africa/Cairo",
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(iso));

const DIRECTION_AR: Record<string, string> = {
  OUTBOUND: "ذهاب",
  RETURN: "عودة",
};

/** Outbound passengers board at their stop; on the return they get off there. */
const tripLine = (b: BookingFacts) =>
  `${b.routeName} (${DIRECTION_AR[b.direction] ?? b.direction}) — ${cairoTime(b.departureAt)} — ${
    b.direction === "RETURN" ? "محطة النزول" : "محطة الركوب"
  }: ${b.boardingStopName}`;

/** Lines in, a plain-text and an RTL HTML body out. Values are escaped. */
function layout(subject: string, lines: string[]): RenderedEmail {
  return {
    subject,
    text: lines.join("\n\n"),
    html:
      `<div dir="rtl" lang="ar" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8">` +
      lines.map((line) => `<p>${escape(line)}</p>`).join("") +
      `</div>`,
  };
}

export function renderTemplate<T extends NotificationTemplate>(
  template: T,
  payload: TemplatePayloads[T],
): RenderedEmail {
  switch (template) {
    case NotificationTemplate.VerifyEmail: {
      const p = payload as TemplatePayloads["VERIFY_EMAIL"];
      return layout(`رمز تأكيد البريد: ${p.code}`, [
        `مرحبًا ${p.name}،`,
        `رمز تأكيد بريدك في منظومة النقل الجامعي: ${p.code}`,
        `الرمز صالح لمدة ${p.minutes} دقائق ولمرة واحدة. لا تشاركه مع أي شخص.`,
        "إذا لم تنشئ حسابًا، تجاهل هذه الرسالة.",
      ]);
    }
    case NotificationTemplate.ResetPassword: {
      const p = payload as TemplatePayloads["RESET_PASSWORD"];
      return layout(`رمز استعادة كلمة المرور: ${p.code}`, [
        `مرحبًا ${p.name}،`,
        `رمز استعادة كلمة المرور: ${p.code}`,
        `الرمز صالح لمدة ${p.minutes} دقائق ولمرة واحدة. لا تشاركه مع أي شخص.`,
        "إذا لم تطلب ذلك، تجاهل الرسالة؛ كلمة مرورك الحالية لم تتغير.",
      ]);
    }
    case NotificationTemplate.SignInCode: {
      const p = payload as TemplatePayloads["SIGN_IN_CODE"];
      return layout(`رمز الدخول: ${p.code}`, [
        p.name ? `مرحبًا ${p.name}،` : "مرحبًا،",
        `رمز الدخول إلى منظومة النقل الجامعي: ${p.code}`,
        `الرمز صالح لمدة ${p.minutes} دقائق ولمرة واحدة. لا تشاركه مع أي شخص، ولن يطلبه منك أحد من الجامعة.`,
        "إذا لم تطلب الدخول، تجاهل هذه الرسالة.",
      ]);
    }
    case NotificationTemplate.EmailChanged: {
      const p = payload as TemplatePayloads["EMAIL_CHANGED"];
      return layout("تم تغيير البريد الإلكتروني لحسابك", [
        p.name ? `مرحبًا ${p.name}،` : "مرحبًا،",
        `تم تغيير البريد الإلكتروني لحسابك في منظومة النقل الجامعي إلى ${p.newEmailMasked}.`,
        "إذا لم تقم بهذا التغيير، تواصل مع مكتب النقل فورًا.",
      ]);
    }
    case NotificationTemplate.SubscriptionStatusChanged: {
      const p = payload as TemplatePayloads["SUBSCRIPTION_STATUS_CHANGED"];
      const headline = STATUS_AR[p.status] ?? "تم تحديث حالة اشتراكك";
      return layout(headline, [
        `مرحبًا ${p.name}،`,
        `${headline}: ${p.routeName} — ${p.planName}.`,
        `السبب: ${p.reason}`,
        p.status === "NEEDS_INFO"
          ? "برجاء الدخول إلى المنظومة وإعادة إرسال الطلب بعد الاستكمال."
          : "يمكنك متابعة التفاصيل من صفحة اشتراكاتك.",
      ]);
    }
    case NotificationTemplate.SubscriptionPaymentRecorded: {
      const p = payload as TemplatePayloads["SUBSCRIPTION_PAYMENT_RECORDED"];
      return layout("تم تسجيل دفعة لاشتراكك", [
        `مرحبًا ${p.name}،`,
        `تم تسجيل دفعة بقيمة ${egp(p.amountMinor)} لاشتراك ${p.routeName} — ${p.planName}.`,
        p.paidInFull
          ? "تم سداد الاشتراك بالكامل، ويمكنك الحجز الآن."
          : "الاشتراك لم يُسدد بالكامل بعد؛ الحجز يُفتح عند اكتمال السداد.",
      ]);
    }
    case NotificationTemplate.SubscriptionRefundRecorded: {
      const p = payload as TemplatePayloads["SUBSCRIPTION_REFUND_RECORDED"];
      return layout("تم تسجيل استرداد لمبلغ اشتراكك", [
        `مرحبًا ${p.name}،`,
        `تم تسجيل استرداد بقيمة ${egp(p.amountMinor)} لطلب اشتراك ${p.routeName} — ${p.planName}.`,
      ]);
    }
    case NotificationTemplate.BookingConfirmed: {
      const p = payload as TemplatePayloads["BOOKING_CONFIRMED"];
      return layout("تم تأكيد حجزك", [
        `مرحبًا ${p.name}،`,
        `تم تأكيد حجزك: ${tripLine(p)}.`,
        "يمكنك إلغاء الحجز من صفحة حجوزاتك قبل موعد غلق الإلغاء.",
      ]);
    }
    case NotificationTemplate.BookingCancelled: {
      const p = payload as TemplatePayloads["BOOKING_CANCELLED"];
      return layout("تم إلغاء حجزك", [
        `مرحبًا ${p.name}،`,
        `تم إلغاء حجزك بناءً على طلبك: ${tripLine(p)}.`,
      ]);
    }
    case NotificationTemplate.BookingCancelledByAdmin: {
      const p = payload as TemplatePayloads["BOOKING_CANCELLED_BY_ADMIN"];
      return layout("تم إلغاء حجزك من إدارة الحركة", [
        `مرحبًا ${p.name}،`,
        `تم إلغاء حجزك: ${tripLine(p)}.`,
        `السبب: ${p.reason}`,
        "نعتذر عن ذلك. يمكنك اختيار رحلة أخرى من صفحة الرحلات المتاحة.",
      ]);
    }
    case NotificationTemplate.ComplaintUpdated: {
      const p = payload as TemplatePayloads["COMPLAINT_UPDATED"];
      const headline = {
        RECEIVED: "تم استلام رسالتك",
        REPLIED: "رد جديد على رسالتك",
        RESOLVED: "تم الرد على رسالتك وحلها",
        CLOSED: "تم إغلاق رسالتك",
      }[p.event];
      return layout(`${headline} — ${p.reference}`, [
        p.name ? `مرحبًا ${p.name}،` : "مرحبًا،",
        `${headline}: «${p.subject}» (رقم المتابعة ${p.reference}).`,
        ...(p.message ? [`الرد: ${p.message}`] : []),
        p.event === "CLOSED"
          ? "إذا احتجت مساعدة أخرى، يمكنك إرسال رسالة جديدة."
          : "تابعها ورد عليها من «متابعة الشكاوى» بعد الدخول برمز البريد.",
      ]);
    }
    case NotificationTemplate.GroupTripUpdated: {
      const p = payload as TemplatePayloads["GROUP_TRIP_UPDATED"];
      const headline = {
        RECEIVED: "تم استلام طلب الرحلة",
        NEEDS_INFO: "طلب الرحلة يحتاج استكمال بيانات",
        APPROVED: "تمت الموافقة على طلب الرحلة",
        REJECTED: "تم رفض طلب الرحلة",
        CANCELLED: "تم إلغاء الرحلة",
      }[p.event];
      return layout(`${headline} — ${p.reference}`, [
        p.name ? `مرحبًا ${p.name}،` : "مرحبًا،",
        `${headline}: ${p.destination} — ${cairoTime(p.departureAt)} (رقم الطلب ${p.reference}).`,
        ...(p.reason ? [`ملاحظة مكتب الحركة: ${p.reason}`] : []),
        ...p.buses.map(
          (b) =>
            `الأتوبيس ${b.plate} — السائق ${b.driverName}${b.driverPhone ? ` (${b.driverPhone})` : ""}`,
        ),
        p.event === "NEEDS_INFO"
          ? "برجاء الدخول إلى المنظومة واستكمال الطلب ثم إعادة إرساله."
          : "يمكنك متابعة الطلب من صفحة طلبات الرحلات.",
      ]);
    }
  }
  throw new Error(`Unknown template ${String(template)}`);
}
