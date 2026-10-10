import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAppConfig } from "../../src/config/app-config.js";
import { renderTemplate } from "../../src/modules/notifications/notification-template.js";
import {
  emailOtpMatches,
  generateEmailOtp,
  hashEmailOtp,
} from "../../src/modules/auth/otp/email-otp.js";

test("templates are Arabic, right-to-left, and escape every value", () => {
  const email = renderTemplate("SUBSCRIPTION_STATUS_CHANGED", {
    name: "<script>alert(1)</script>",
    routeName: "الخط الغربي",
    planName: "سنوي",
    status: "NEEDS_INFO",
    reason: 'a "quoted" & <b>bold</b> reason',
  });
  assert.match(email.html, /^<div dir="rtl" lang="ar"/);
  assert.doesNotMatch(email.html, /<script>|<b>/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.subject, /استكمال/);
  assert.match(email.text, /إعادة إرسال الطلب/);
});

test("payment emails print EGP from piasters", () => {
  const email = renderTemplate("SUBSCRIPTION_PAYMENT_RECORDED", {
    name: "x",
    routeName: "r",
    planName: "p",
    amountMinor: 150050,
    paidInFull: true,
  });
  assert.match(email.text, /1500\.50 جنيه/);
});

test("email codes are 6 digits and hashed with a key", () => {
  for (let i = 0; i < 50; i++) assert.match(generateEmailOtp(), /^\d{6}$/);
  const a = hashEmailOtp("key-1", "user", "VERIFY_EMAIL", "123456");
  assert.ok(
    emailOtpMatches(a, hashEmailOtp("key-1", "user", "VERIFY_EMAIL", "123456")),
  );
  assert.ok(
    !emailOtpMatches(
      a,
      hashEmailOtp("key-2", "user", "VERIFY_EMAIL", "123456"),
    ),
  );
  assert.ok(
    !emailOtpMatches(
      a,
      hashEmailOtp("key-1", "user", "RESET_PASSWORD", "123456"),
    ),
  );
});

test("mail configuration: production needs SMTP; domains are validated", () => {
  const base = {
    DATABASE_URL: "postgresql://localhost/test",
    JWT_SECRET: "s".repeat(64),
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  };
  assert.equal(loadAppConfig(base).mail.transport, "disabled");
  assert.throws(
    () => loadAppConfig({ ...base, NODE_ENV: "production" }),
    /MAIL_TRANSPORT=smtp/,
  );
  assert.throws(
    () => loadAppConfig({ ...base, MAIL_TRANSPORT: "smtp" }),
    /SMTP_HOST/,
  );
  const smtp = loadAppConfig({
    ...base,
    MAIL_TRANSPORT: "smtp",
    SMTP_HOST: "localhost",
    MAIL_FROM: "BSU Bus <no-reply@bsu.example>",
  });
  assert.equal(smtp.mail.port, 587);
  assert.deepEqual(
    loadAppConfig({
      ...base,
      ALLOWED_EMAIL_DOMAINS: " BSU.edu.eg , staff.bsu.edu.eg",
    }).allowedEmailDomains,
    ["bsu.edu.eg", "staff.bsu.edu.eg"],
  );
  assert.throws(() =>
    loadAppConfig({ ...base, ALLOWED_EMAIL_DOMAINS: "@bsu" }),
  );
});

test("booking emails show the departure in Cairo time, in Arabic", () => {
  const email = renderTemplate("BOOKING_CANCELLED_BY_ADMIN", {
    name: "سارة",
    routeName: "الخط الغربي",
    boardingStopName: "جامعة القاهرة",
    direction: "OUTBOUND",
    // 05:00 UTC in October 2026 is 08:00 in Cairo (UTC+3).
    departureAt: "2026-10-11T05:00:00Z",
    reason: "عطل في الأتوبيس",
  });
  assert.match(email.text, /ذهاب/);
  assert.match(email.text, /أكتوبر/);
  assert.match(email.text, /٨:٠٠|8:00/);
  assert.match(email.text, /السبب: عطل في الأتوبيس/);
  assert.match(email.subject, /إلغاء/);
});
