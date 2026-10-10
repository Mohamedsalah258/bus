# البنية المعمارية وقواعد الكود

Modular monolith على NestJS: تطبيق واحد يُنشر كوحدة واحدة، مقسم داخليًا إلى وحدات (modules) لكل منها حدود واضحة. لا خدمات مصغرة ولا ORM؛ استعلامات `pg` بمعاملات (parameterized) فقط.

## شجرة المشروع

```text
src/
├── main.ts                 نقطة التشغيل فقط
├── app.module.ts           تجميع الوحدات + الحراس العامة (Throttler ثم Auth)
├── app.setup.ts            خط HTTP المشترك: helmet، prefix، validation، errors، CORS، Swagger
├── openapi.ts              بناء عقد OpenAPI (يستخدمه الخادم وسكربت التصدير)
├── config/                 قراءة الإعدادات والتحقق منها مرة واحدة (APP_CONFIG)
├── database/               Pool وtransaction وأكواد أخطاء PostgreSQL
├── common/                 عناصر عامة بلا منطق أعمال: pagination، filter، validators
└── modules/
    ├── health/             live / ready
    ├── auth/               تسجيل، دخول، JWT، الحارس، decorators (Public/Roles/CurrentUser)
    ├── users/              مستودع المستخدمين والأدوار
    ├── audit/              تسجيل الأحداث داخل نفس المعاملة + عرضها للأدمن
    ├── faculties/          الكليات
    ├── seasons/            المواسم
    ├── routes/             الخطوط والمحطات
    ├── fleet/              المركبات والسائقون
    ├── subscriptions/      طلب الاشتراك ومراجعته
    ├── trips/              الرحلات وقواعد الجدولة وتعارض التخصيص
    └── bookings/           الحجز والإلغاء وضمانات السعة
test/
├── unit/                   منطق نقي بلا قاعدة بيانات
├── e2e/                    دورة HTTP كاملة على PGlite (تتابعية)
├── integration/            PostgreSQL حقيقي: التزامن والأقفال والترحيل
└── support/                أدوات مشتركة للاختبارات
```

## شكل الوحدة

```text
modules/<feature>/
├── <feature>.module.ts       يعلن ما يملكه وما يصدّره
├── <feature>.controller.ts   HTTP فقط: المسار، الصلاحية، DTO، استدعاء الخدمة
├── <feature>.service.ts      قواعد الأعمال وحدود المعاملات
├── <feature>.repository.ts   SQL فقط؛ لا قرارات أعمال
├── <feature>-status.ts       ثوابت الحالات ونوعها (as const)
└── dto/                      create-<x>.dto.ts، list-<x>-query.dto.ts ...
```

## اتجاه الاعتماد

```text
Controller → Service → Repository → Database
```

- الـ Controller لا يستورد `database/` ولا أي `*.repository`. القاعدة مفروضة بـ ESLint.
- الخدمة تملك المعاملة: `db.transaction(async (tx) => …)` وتمرر `tx` لكل مستودع يشارك فيها.
- كل دالة مستودع داخل معاملة تستقبل `tx: Queryable` صراحة؛ دوال القراءة المستقلة تستخدم الـ pool.
- الوحدة تصدّر المستودع الذي تحتاجه وحدة أخرى فقط (مثلًا `TripsRepository` لـ bookings)، ولا تصدّر الـ controllers.
- `AuditService.record(tx, …)` يُستدعى داخل نفس المعاملة حتى يُثبت الحدث مع التغيير أو يُلغى معه.

## بروتوكول الأقفال (لا يُكسر)

| العملية       | ترتيب الأقفال                                                    |
| ------------- | ---------------------------------------------------------------- |
| حجز / إلغاء   | `users` (المستخدم) ← `trips` (الرحلة) ← عدّ المؤكد ← إدراج/تحديث |
| إنشاء رحلة    | `vehicles` ← `drivers` ← فحص التداخل ← إدراج                     |
| مراجعة اشتراك | `subscriptions` (السجل نفسه)                                     |

أي كاتب جديد على `bookings` أو تخصيص المركبات (إلغاء إداري، قائمة انتظار، تبديل مركبة) يجب أن يأخذ الأقفال بنفس الترتيب، وإلا يصبح الـ deadlock أو تجاوز السعة ممكنًا. اختبار `test/integration` هو المرجع؛ أي تعديل على هذه المسارات لا يُدمج دون نجاحه على PostgreSQL حقيقي.

## اصطلاحات

- **التسمية:** ملفات kebab-case بلاحقة الدور (`.controller.ts`، `.service.ts`، `.repository.ts`، `.dto.ts`، `.module.ts`). DTO للكتابة `Create<X>Dto`، وللاستعلام `List<X>QueryDto`.
- **الحالات والأدوار:** كائن `as const` + نوع مشتق في ملف مستقل (`UserRole`، `TripStatus`، `BookingStatus`)؛ لا نصوص حرفية متفرقة في الكود. نصوص SQL تبقى حرفية لأنها تعكس قيود الجدول.
- **الاستيراد:** مسارات نسبية بامتداد `.js` (ESM + NodeNext). لا barrel files.
- **الأخطاء:** استثناءات Nest القياسية من الخدمة؛ `AllExceptionsFilter` يوحد الشكل `{ statusCode, message, requestId }` ويحوّل أكواد PostgreSQL المعروفة.
- **العقد:** المدخلات والمخرجات `camelCase`. كل رد له class في `dto/<x>.response.ts` مع `@ApiProperty`، والـ Controller يعلنه بـ `@ApiOkResponse` أو `@ApiCreatedResponse` أو `@ApiPageResponse`. التحويل من أعمدة PostgreSQL يتم داخل الـ repository بـ aliases صريحة (`faculty_id AS "facultyId"`)، وممنوع `SELECT *` حتى لا يتسرب عمود داخلي. التواريخ التقويمية تُرجع كنص (`starts_on::text`). القوائم ترجع `PageDto` عن طريق `toPage()`. `npm run openapi:export` بعد أي تغيير في مسار أو DTO.
- **السجلات:** `JsonLogger` يكتب سطر JSON لكل حدث، و`requestLoggingMiddleware` يسجل سطرًا لكل طلب فيه requestId والمسار كنمط (route pattern) والحالة والمدة ومعرّف المستخدم. ممنوع تسجيل body أو query string أو headers أو stack trace.
- **الصلاحيات:** الـ endpoint يطلب `@RequirePermissions(Permission.X)`، ولا يذكر أدوارًا أبدًا. ربط الأدوار بالصلاحيات في `modules/auth/permissions.ts` فقط. أي قيد على نطاق البيانات (زي كلية المنسق) يُطبق في الـ service، لأن الصلاحية بتقول "مسموح" والنطاق بيقول "على أنهي بيانات".
- **الإشعارات:** أي وحدة ترسل بريدًا عن طريق `NotificationsService.send(tx, ...)` داخل نفس المعاملة، ولا تنادي SMTP مباشرة. الإرسال الفعلي يتم في `NotificationDispatcher` بـ `FOR UPDATE SKIP LOCKED`، فأكثر من نسخة تقدر تشتغل من غير ما يتبعت إيميل مرتين. أي قالب جديد يتضاف في `notification-template.ts`، وأي محتوى سري يتعلم `sensitive`.
- **السجلات المالية:** جدول المدفوعات append-only: لا UPDATE ولا DELETE. التصحيح بقيد عكسي (`REVERSAL`) والاسترداد بقيد (`REFUND`)، والمبلغ الصافي وحالة السداد يُعاد حسابهما بعد كل قيد.
- **الوحدات المشتركة:** لو وحدتين محتاجين نفس البيانات في اتجاهين (الرحلات والحجوزات)، يتفصل الجزء المشترك في وحدة صغيرة (`BookingsCoreModule`) بدل الاعتماد الدائري.
- **دورات الحياة:** الانتقال بين الحالات معرّف في جدول واحد (زي `TRANSITIONS` في `subscription-status.ts`)، والـ service بترفض أي انتقال مش موجود فيه بـ 409.
- **حالة الحساب:** الحارس يرفض أي طلب لحساب محتاج يغيّر كلمة المرور أو يسجل MFA، إلا المسارات المعلّمة بـ `@AllowIncompleteAccount()`.
- **حدود الطلبات:** المسارات العامة تُحسب بالـ IP دائمًا، والمحمية بالتوكن (`AppThrottlerGuard`). أي حد يجب أن يصمد مع أكثر من نسخة يُخزن في PostgreSQL، زي `login_throttle`.
- **الترحيلات:** ملف SQL جديد مرقّم لكل تغيير؛ لا يُعدّل ملف طُبّق (الـ checksum يرفضه).

## إضافة وحدة جديدة

1. أنشئ `modules/<feature>/` بالشكل أعلاه، وثوابت الحالة إن وجدت.
2. أضف ترحيل `migrations/00N_<feature>.sql`.
3. سجّل الوحدة في `app.module.ts` تحت المجموعة المناسبة.
4. اختبار unit لأي قاعدة نقية، وتوسيع e2e للمسار، وintegration إن لمس الأقفال.
5. `npm run check` ثم `npm run openapi:export`.
