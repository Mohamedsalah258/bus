# API walkthrough

Prefix: `/api/v1`. Use `Authorization: Bearer <accessToken>` except for registration, login, MFA verification, refresh, password recovery, faculty and category listing, and health.

**Contract conventions (0.2.0).** Request and response keys are `camelCase`. Calendar dates are `YYYY-MM-DD` strings; timestamps are ISO-8601 UTC. Every list returns an envelope `{ "items": [...], "total": 42, "limit": 25, "offset": 0 }`, where `total` ignores paging. Every response carries an `X-Request-Id` header (a valid UUID sent by the caller is reused), and the same id appears in error bodies.

The OpenAPI contract in `openapi.json` is generated from actual route metadata and DTOs. It documents request schemas; response examples below clarify the initial SQL-backed response conventions.

## Authentication

`POST /auth/register`:

```json
{
  "email": "member@example.edu",
  "password": "a-unique-long-password",
  "name": "اسم المستفيد",
  "facultyId": "UUID_FROM_FACULTIES",
  "categoryId": "UUID_FROM_CATEGORIES"
}
```

The placeholder must be replaced with a real UUID. Extra fields, including `role`, are rejected. Passwords must be 12–128 characters.

Login accepts `email` and `password`. After **5 failed attempts for one email within a minute**, further attempts for that email return `429` until the minute passes, whether or not the email exists, and even with the right password. The counter is stored in PostgreSQL, so it holds across API instances. Per-IP limits on public auth routes (login 100/min, register 30/min, refresh 100/min) are deliberately high so many users behind one campus IP are not locked out.

Login response:

```json
{
  "accessToken": "JWT",
  "refreshToken": "opaque",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "refreshExpiresIn": 2592000
}
```

The access token lasts 15 minutes. Before it expires, `POST /auth/refresh` with `{ "refreshToken": "..." }` returns a new pair. **Each refresh token works once**: store the new one every time. Presenting an already-used refresh token is treated as theft, revokes that whole session and is recorded in the audit log, so a client must not retry a refresh blindly with the old token. `POST /auth/logout` ends every session of the user: all access and refresh tokens.

## Members: password-free sign-in (like the old site)

Members do not need a password or a separate registration. This mirrors the old site's forms, with a code instead of the national ID.

1. `POST /auth/code/request` `{ email }` → `202`, the same answer for any email. A 6-digit code is emailed (10 minutes, one use, one a minute).
2. `POST /auth/code/verify` `{ email, code }` → tokens. The first success creates the member account, already verified.
3. `POST /subscriptions/apply` — the old subscription form in one request:

```json
{
  "name": "منى أحمد محمد علي",
  "phone": "01012345678",
  "jobTitle": "مدرس",
  "facultyId": "FACULTY_UUID",
  "categoryId": "CATEGORY_UUID",
  "planId": "PLAN_UUID",
  "routeId": "ROUTE_UUID"
}
```

It saves the profile and submits the request in one transaction. The old form's national ID and address are not collected; the academic year is the chosen plan.

| Old screen       | New flow                                                |
| ---------------- | ------------------------------------------------------- |
| طلب الاشتراك     | code sign-in → `POST /subscriptions/apply`              |
| حجز أتوبيس       | code sign-in → `POST /bookings`                         |
| اعرف حجوزاتك     | code sign-in → `GET /bookings/mine` (own bookings only) |
| حجز رحلة (أنشطة) | group trip request (BL-15, not built yet)               |
| متابعة الشكاوى   | complaint number + code to the complainant (BL-18)      |

`GET /auth/me` reports `profileComplete`; `PATCH /auth/me/profile` edits name, phone and job title (members also faculty and category, audited). Staff accounts never receive sign-in codes: they keep password + MFA. Password registration and login still work for members who prefer them.

## Email verification and recovery (BL-05, decisions D3 and D6)

Identity is proven by a 6-digit code sent to the email; email is the only notification channel. Registration (and accounts created by an administrator) start **unverified**: until `POST /auth/email/verify` with `{ "code": "123456" }` succeeds, every other endpoint answers `403 Email verification required`. `GET /auth/me` reports `emailVerified`.

- A code lives 10 minutes, works once, and allows 5 wrong tries; then a new code is needed.
- `POST /auth/email/resend` sends a new code: at most one a minute and five an hour (`429` otherwise).
- `POST /auth/password/forgot` with `{ email }` always answers `202` with the same message, whether or not the account exists.
- `POST /auth/password/reset` with `{ email, code, newPassword }` sets the password, verifies the email, lifts a forced password change and ends every session. Wrong codes are limited per email.
- Registration can be limited to university domains with `ALLOWED_EMAIL_DOMAINS`.

Emails are written to an outbox in the same transaction as the event and delivered in the background with retries (1 min, 5 min, 15 min, 1 h, 4 h, then `FAILED`). A mail outage never undoes a registration or a decision. One-time codes are erased from the outbox once delivery ends.

## Second factor (BL-06)

ADMIN and DISPATCHER accounts must enrol a TOTP authenticator before any other endpoint works (they get `403 Two-factor authentication must be set up for this role`). `GET /auth/me` reports `mfaRequired` and `mfaEnabled`.

1. `POST /auth/mfa/setup` → `{ secret, otpauthUrl }`. Show `otpauthUrl` as a QR code.
2. `POST /auth/mfa/activate` with `{ "code": "123456" }` → `{ recoveryCodes: [10 codes] }`, shown once. All sessions end; log in again.
3. From then on, `POST /auth/login` returns `{ "mfaRequired": true, "mfaToken": "...", "mfaTokenExpiresIn": 300 }` instead of tokens. Send `POST /auth/mfa/verify` with `{ mfaToken, code }` or `{ mfaToken, recoveryCode }` to receive the token pair.

A code works once (a replay in the same 30-second window is refused). Each recovery code works once. After 5 wrong codes within a minute, verification returns `429`. A lost device is handled by an administrator: `POST /users/{id}/mfa/reset`.

## Accounts created by an administrator (BL-04)

`POST /users` creates staff (or pre-approved members) with a `temporaryPassword` handed over out of band. Until the user calls `POST /auth/password` with `{ currentPassword, newPassword }`, every other endpoint answers `403 Password change required`. Changing the password ends other sessions and returns a fresh token pair.

| Method | Path                         | Body                                | Effect                               |
| ------ | ---------------------------- | ----------------------------------- | ------------------------------------ |
| GET    | `/users`                     | `?role=&active=&facultyId=&search=` | Paged administrative view            |
| PATCH  | `/users/{id}/role`           | `{ role, facultyId?, reason }`      | Immediate; audited from → to         |
| PATCH  | `/users/{id}/status`         | `{ active, reason }`                | Deactivation ends all sessions       |
| POST   | `/users/{id}/password/reset` | `{ temporaryPassword, reason }`     | Forces a change; ends all sessions   |
| POST   | `/users/{id}/mfa/reset`      | `{ reason }`                        | User enrols again; ends all sessions |

Administrators cannot act on their own account through these endpoints, and the last active administrator cannot be demoted or deactivated (`409`). `FACULTY_COORDINATOR` requires `facultyId`.

## Roles and permissions (BL-03)

| Role                    | May do                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| `ADMIN`                 | Everything                                                                |
| `DISPATCHER`            | Routes, fleet, trips; read and review all subscriptions                   |
| `FACULTY_COORDINATOR`   | Read and review subscriptions of applicants **in their own faculty only** |
| `AUDITOR`               | Read-only: audit log, users, subscriptions                                |
| `MEMBER`                | Request subscriptions, book and cancel own trips                          |
| `SUPPORT`, `SUPERVISOR` | Reserved; permissions arrive with complaints (BL-18) and boarding (BL-25) |

The matrix lives in one file, `src/modules/auth/permissions.ts`.

## Beneficiary categories

Categories are data the university defines (decision D1), e.g. `FACULTY_MEMBER`, `EMPLOYEE`, `STUDENT`. `GET /categories` is public for the registration form; `POST /categories` with `{ code, name }` is ADMIN only. Each route lists the categories allowed to subscribe: `eligibleCategoryIds` on creation, replaced later with `PUT /routes/{id}/eligible-categories` `{ categoryIds, reason }`. A member whose category is not listed gets `403` when requesting a subscription. Changing the list does not revoke existing subscriptions.

## Initial setup — administrative token

| Method | Path          | Body / result                                                                                                                 |
| ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/faculties`  | `{"name":"كلية العلوم"}`; ADMIN only                                                                                          |
| POST   | `/seasons`    | `{"name":"2026/2027","startsOn":"2026-10-01","endsOn":"2027-09-30"}`; ADMIN                                                   |
| POST   | `/categories` | `{"code":"EMPLOYEE","name":"موظف"}`; ADMIN                                                                                    |
| POST   | `/routes`     | `{"name":"الخط الغربي","stops":[{"name":"جامعة القاهرة"},{"name":"جامعة بني سويف"}],"eligibleCategoryIds":["CATEGORY_UUID"]}` |
| POST   | `/vehicles`   | `{"plate":"TEST-001","capacity":40}`                                                                                          |
| POST   | `/drivers`    | `{"name":"اسم السائق"}`                                                                                                       |

Route creation returns `id` and `stops[]`, each with its own `id`. Do not use a route ID as the boarding stop ID.

`POST /trips` (dates are illustrative; always choose future dates):

```json
{
  "routeId": "ROUTE_UUID",
  "vehicleId": "VEHICLE_UUID",
  "driverId": "DRIVER_UUID",
  "direction": "OUTBOUND",
  "departureAt": "2027-01-10T07:00:00+02:00",
  "arrivalAt": "2027-01-10T09:00:00+02:00",
  "bookingClosesAt": "2027-01-10T06:00:00+02:00",
  "cancellationClosesAt": "2027-01-10T05:00:00+02:00",
  "capacity": 40
}
```

The API validates chronology, active resources, vehicle capacity and overlapping vehicle/driver assignments. Direction is `OUTBOUND` or `RETURN`. Use Cairo's correct offset for the travel date; do not assume a fixed offset year-round.

## Plans and subscriptions (BL-08, decision D2)

A season offers **plans**: annual or term, free or paid. `GET /plans?seasonId=` lists open plans; `POST /plans` (ADMIN) creates one inside the season's dates, with `feeMinor` in piasters (EGP × 100; `0` = free).

```json
{
  "seasonId": "SEASON_UUID",
  "name": "الفصل الأول",
  "period": "TERM",
  "startsOn": "2026-10-01",
  "endsOn": "2027-01-31",
  "feeMinor": 150000
}
```

Member: `POST /subscriptions` with `{ "planId": "...", "routeId": "..." }`. A request overlapping a live subscription on the same route is refused (`409`).

Lifecycle (any other move answers `409`):

| From                | Action                                    | To                               | Who                       |
| ------------------- | ----------------------------------------- | -------------------------------- | ------------------------- |
| PENDING             | `PATCH /{id}/review` `{ status, reason }` | APPROVED, REJECTED or NEEDS_INFO | Reviewer (faculty-scoped) |
| NEEDS_INFO          | `PATCH /{id}/resubmit` `{ note }`         | PENDING                          | Applicant                 |
| PENDING, NEEDS_INFO | `PATCH /{id}/withdraw`                    | WITHDRAWN                        | Applicant                 |
| APPROVED            | `PATCH /{id}/suspend` `{ reason }`        | SUSPENDED                        | Reviewer                  |
| SUSPENDED           | `PATCH /{id}/reinstate` `{ reason }`      | APPROVED                         | Reviewer                  |

REJECTED and WITHDRAWN are final, and the applicant may apply again. Staff decisions email the applicant. `GET /subscriptions/{id}` returns the detail with payments to the owner or a reviewer in scope (others get `404`). `expired` is true once the plan's dates have passed.

**Payment (no gateway in this phase).** Paid plans start `UNPAID`. Staff record each payment: `POST /subscriptions/{id}/payments` with `{ amountMinor, method: CASH | BANK_TRANSFER | SALARY_DEDUCTION | OTHER, reference?, paidOn }`. Partial payments add up; overpayment and future dates are refused. Reaching the fee sets `PAID` and emails the applicant.

**Corrections (BL-32).** The payment ledger is append-only. A mistaken payment is cancelled with `POST /subscriptions/{id}/payments/{paymentId}/reverse` `{ reason }` (a `REVERSAL` row; each payment once). Money handed back for a `REJECTED` or `WITHDRAWN` request is `POST /subscriptions/{id}/refunds` with the payment fields plus `reason` (a `REFUND` row, at most the net paid; the applicant is emailed). `paidMinor` is always the net, and the payment status is recomputed after every entry; a reversal can close the booking gate again.

**Booking requires** `APPROVED`, payment `PAID` or `NOT_REQUIRED`, and a trip date inside the plan's dates. Bookings and cancellations email the passenger (BL-17).

## Administration tools

- **Catalog (BL-10):** `PATCH /seasons/{id}` `{ name?, startsOn?, endsOn?, reason }` (refused while a plan would fall outside), `PATCH /categories/{id}` `{ name?, active?, reason }` (inactive: no new registrations or requests in it), `PATCH /faculties/{id}` `{ name, reason }`. Vehicles, drivers and routes: see above.
- **Audit log (BL-21):** `GET /audit-events?action=&entityId=&actorId=&from=&to=` (Cairo dates).
- **User data (BL-33):** staff correct a user with `PATCH /users/{id}/profile` `{ name?, phone?, jobTitle?, facultyId?, categoryId?, reason }`. Anyone changes their own sign-in email in two steps: `POST /auth/email/change` `{ newEmail }` sends a code to the new address; `POST /auth/email/change/confirm` `{ code }` switches it and warns the old address.
- **Failed emails (BL-34, ADMIN):** `GET /notifications?status=FAILED&template=` lists deliveries without their content; `POST /notifications/{id}/retry` requeues one. One-time codes are erased after failure and cannot be resent: the user requests a new code.
- **Recovery codes (BL-35):** `POST /auth/mfa/recovery-codes` `{ code }` with a current authenticator code replaces all ten.

## Reports (BL-20)

`ADMIN`, `DISPATCHER` and `AUDITOR`. Every report takes `from` and `to` (Cairo calendar dates, inclusive, at most 366 days); add `format=csv` to download a UTF-8 CSV that opens in Excel with Arabic intact. Every CSV export is recorded in the audit log.

| Report              | Path                                 | Content                                                                              |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| Daily bookings      | `/reports/bookings-daily`            | Per travel date: trips, seats, confirmed, cancelled by passenger, cancelled by staff |
| Occupancy by route  | `/reports/occupancy`                 | Trips, seats, confirmed, occupancy %                                                 |
| Bookings by faculty | `/reports/occupancy?groupBy=faculty` | Confirmed bookings and distinct passengers                                           |
| Subscriptions       | `/reports/subscriptions`             | Requests by status, top rejection reasons, average decision hours, pending now       |
| Complaints          | `/reports/complaints`                | By status and kind, average resolution hours                                         |

Definitions: a trip counts when it offered seats (published, closed, running or completed; never drafts, cancelled or group trips); occupancy = confirmed bookings ÷ seats. CSV cells that start with `=`, `+`, `-` or `@` are escaped so spreadsheets never run them as formulas.

## News and alerts (BL-19)

The old homepage's «جديد الأخبار». `GET /news` is public: pinned first, newest first, excluding hidden, scheduled and expired posts; filter with `kind` (`NEWS` | `ALERT`) and `routeId` (route alerts plus general posts). `GET /news/{id}`.

Staff (`ADMIN`, `DISPATCHER`): `POST /news` `{ kind, title, body, routeId?, pinned?, publishedAt?, expiresAt? }`, `PATCH /news/{id}` (any field, `active: false` hides), `GET /news/manage` for everything including hidden posts.

## Group trips — student activities (BL-15, decision D7)

Replaces the old «حجز رحلة (الأنشطة الطلابية)» form. The transport office decides.

**Requester** (after code sign-in): `POST /group-trips` with the old form's fields minus national ID and academic year: `name`, `phone`, `facultyId`, `organization` (الجهة), `purpose`, `destination`, `details?`, `pickupLocation`, `passengers`, `departureAt`, `returnAt`. Returns a reference like `G-2026-000001`, also emailed. `GET /group-trips/mine`; `PATCH /group-trips/{id}/resubmit` `{ note }` after a request for information; `PATCH /group-trips/{id}/withdraw` before approval.

**Transport office** (`DISPATCHER`, `ADMIN`; `AUDITOR` reads): `GET /group-trips?status=` (pending first, soonest first) and:

| Action                   | Body                                                 | Effect                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /{id}/approve`    | `{ assignments: [{ vehicleId, driverId }], reason }` | Seats must cover `passengers`; every bus and driver must be free for the whole outing. Creates one `GROUP` trip per bus, holding it from departure to return. |
| `PATCH /{id}/needs-info` | `{ reason }`                                         | Not a rejection; the requester completes and resubmits                                                                                                        |
| `PATCH /{id}/reject`     | `{ reason }`                                         | Final                                                                                                                                                         |
| `PATCH /{id}/cancel`     | `{ reason }`                                         | Approved outings only; cancels its trips and frees the buses                                                                                                  |

`GROUP` trips have no route, never appear in `GET /trips`, and cannot be booked; they appear in the staff schedule. The requester is emailed at every step; the approval email lists each bus plate with its driver's name and phone.

## Complaints and suggestions (BL-18)

Replaces the old «متابعة الشكاوى والمقترحات» page, where anyone with a complaint number could read it.

**Member** (after code sign-in): `POST /complaints` `{ kind: COMPLAINT | SUGGESTION, subject, body, tripId?, subscriptionId? }` returns a reference like `C-2026-000123`, also emailed. A linked trip must be one the member booked. `GET /complaints/mine` is the follow-up page; `POST /complaints/{id}/messages` `{ body }` adds a reply (reopening a resolved complaint); `PATCH /complaints/{id}/close`. At most 10 new complaints per day per account.

**Staff** (`SUPPORT`, `DISPATCHER`; `AUDITOR` read-only): `GET /complaints?status=&kind=&assignedTo=` (open first, oldest first), `GET /complaints/{id}` with the full thread, `POST /complaints/{id}/messages` `{ body, internal? }` (internal notes are never shown to the author; the first public reply assigns and moves it to `IN_PROGRESS`), `PATCH /complaints/{id}/assign` `{ assigneeId }`, `PATCH /complaints/{id}/resolve` `{ message }`.

Status: `OPEN → IN_PROGRESS → RESOLVED → CLOSED`; an author reply reopens `RESOLVED`. Anyone other than the author or complaint staff gets `404`. The author is emailed on receipt, on every public staff reply, on resolution and on closure by staff. Every status change is audited.

## Fleet and route defaults

Drivers carry an optional `phone` (Egyptian mobile, normalized). `PATCH /vehicles/{id}` (`plate`, `capacity`, `active`, `reason`) and `PATCH /drivers/{id}` (`name`, `phone`, `active`, `reason`) are audited; a capacity change does not touch existing trips. Retiring (`active: false`) is refused with `409` while upcoming trips use the resource or a route names it as default.

Each route can record its usual bus and driver: `PUT /routes/{id}/defaults` `{ defaultVehicleId, defaultDriverId, reason }` (either may be `null`). Recurring scheduling will use them.

The driver's name and phone appear in `GET /bookings/mine` only for a confirmed booking on a trip that has not finished. The old site published every driver's phone; this does not.

## Editing stops (BL-09)

`PUT /routes/{id}/stops` `{ stops: [{ id?, name }], reason }` replaces the stop list, in outbound order. Keep an existing stop by sending its `id` with the same name; a new name or a missing stop retires the old row (never deleted) and new entries create new stops. Past bookings therefore keep the exact stop they used. Removing or renaming a stop that upcoming confirmed bookings board at is refused (`409`). Each change bumps the route's `version`; trips record the version they were planned with.

## Opening and closing routes

`PATCH /routes/{id}` `{ name?, active?, reason }` renames, closes (`active: false`) or reopens a route (`RoutesManage`). A closed route disappears from `GET /routes`, and new bookings, subscription requests and trip generation on it are refused at once. Existing bookings are kept; the response's `upcomingTrips` tells staff how many trips are still scheduled, to cancel them if the closure is permanent. Staff see closed routes with `GET /routes?includeInactive=true`. Individual trips are closed, reopened or cancelled with the trip actions below.

Stops are stored toward the university. In `GET /trips`, each trip lists `stops` in travel order: as stored for `OUTBOUND`, reversed for `RETURN`. Booking emails say «محطة الركوب» outbound and «محطة النزول» on the return.

## Loading the old site's routes

`npm run seed:legacy-routes -- --placeholder-capacity=50` loads `data/legacy-routes.json`: the five routes from cars.bsu.edu.eg with their stops, bus and driver, and the categories `FACULTY_MEMBER` and `EMPLOYEE` (both allowed on every route). It is idempotent. Seat counts not published by the old site get the placeholder; correct them with `PATCH /vehicles/{id}`.

## Recurring schedules (BL-11)

Everything is set by staff (`TripsManage`); nothing is hard-coded.

`POST /schedules` defines a recurring trip:

```json
{
  "routeId": "ROUTE_UUID",
  "name": "الخط الغربي — ذهاب الصباح",
  "direction": "OUTBOUND",
  "departureTime": "06:30",
  "durationMinutes": 120,
  "weekdays": ["SAT", "SUN", "MON", "TUE", "WED", "THU"],
  "validFrom": "2026-10-01",
  "validUntil": "2027-06-30",
  "capacity": 45,
  "bookingCloseMinutes": 720,
  "cancellationCloseMinutes": 720
}
```

`departureTime` is Cairo time; daylight-saving changes are handled per date. `weekdays` uses a Saturday-first week. `vehicleId`, `driverId` and `capacity` are optional: they default to the route's bus and driver and the bus's seat count. `PATCH /schedules/{id}` changes future generations only.

`POST /schedules/{id}/generate` `{ from, to, publish?, dryRun? }` creates the real trips (up to 400 days at a time) and returns a report: dates created, holidays skipped, dates already generated (even if cancelled since), dates whose cutoff passed, and bus/driver conflicts. Run with `"dryRun": true` first to preview.

Days without service: `POST /service-exceptions` `{ date, reason }`, `GET /service-exceptions?from=&to=`, `DELETE /service-exceptions/{id}`. Adding one reports `tripsThatDay` already scheduled; cancel them explicitly if needed.

Seats on a single trip: `PATCH /trips/{id}/capacity` `{ capacity, reason }`, never below its confirmed bookings or above its bus.

## Trip lifecycle (BL-12, BL-13)

`POST /trips` publishes immediately unless `"publish": false`, which creates a hidden `DRAFT`. Staff actions (`TripsManage`), each `POST /trips/{id}/<action>`:

| Action                | From                     | To          | Effect                                                                                     |
| --------------------- | ------------------------ | ----------- | ------------------------------------------------------------------------------------------ |
| `publish`             | DRAFT                    | PUBLISHED   | Visible and bookable                                                                       |
| `close`               | PUBLISHED                | CLOSED      | No new bookings; passengers may still cancel until cutoff                                  |
| `reopen`              | CLOSED                   | PUBLISHED   | Refused once the booking cutoff has passed                                                 |
| `start`               | PUBLISHED, CLOSED        | IN_PROGRESS | Bookings and cancellations frozen                                                          |
| `complete`            | IN_PROGRESS              | COMPLETED   | Final                                                                                      |
| `cancel` `{ reason }` | DRAFT, PUBLISHED, CLOSED | CANCELLED   | Every confirmed booking becomes `CANCELLED_BY_ADMIN`; each passenger is emailed the reason |

`GET /trips/schedule?from=&to=&status=` is the staff view (all statuses, `confirmedBookings`); `GET /trips/{id}` the full record. A cancelled trip frees its vehicle and driver.

`PATCH /bookings/{id}/admin-cancel` `{ reason }` cancels one booking (`BookingsManage`). Suspending a subscription cancels its upcoming bookings the same way, with the suspension reason; reinstating does not restore them.

## Round trips (BL-14)

`POST /bookings/round-trip` `{ outbound: { tripId, boardingStopId, idempotencyKey }, return: { tripId, boardingStopId, idempotencyKey } }` books both legs in one transaction: both are confirmed or neither is, and an error names the leg (`"Return trip: Trip is full"`). The trips must be an outbound and a return on the same route, the return leaving after the outbound arrives. Both bookings carry the same `pairId`. `PATCH /bookings/{id}/cancel?withPair=true` cancels both legs.

## Booking — member

`GET /trips?routeId=ROUTE_UUID&limit=25&offset=0` returns future published trips with `remainingSeats`. Displayed availability is advisory until the server confirms the reservation.

`POST /bookings`:

```json
{
  "tripId": "TRIP_UUID",
  "boardingStopId": "STOP_UUID",
  "idempotencyKey": "NEW_CLIENT_GENERATED_UUID"
}
```

Generate a new UUID for a new attempt. Retry a network-uncertain request using exactly the same key and payload. The API returns the original reservation, including a cancelled status if it was later cancelled; it never silently rebooks that request. Reusing a key with a different payload returns 409.

`GET /bookings/mine` returns only the logged-in user's bookings. `PATCH /bookings/{id}/cancel` cancels an owned booking before cutoff and frees capacity. No seat identifiers or national IDs are embedded in public URLs.

## Error format

```json
{ "statusCode": 409, "message": "Trip is full", "requestId": "uuid" }
```

- 400: invalid input, unknown field, invalid relation or invalid timestamps.
- 401: missing/expired/revoked token or invalid login.
- 403: insufficient role or missing approved subscription.
- 404: unknown or unowned booking, or unknown trip.
- 409: capacity, duplicate record/request conflict, overlapping assignment or closed window.
- 429: rate limit; retry later.
- 500: unexpected failure; raw SQL details and credentials are not returned.

Validation errors may contain an array in `message`. Administrative listing endpoints require the appropriate role. `GET /audit-events` is ADMIN-only. Examples contain placeholders, not usable credentials or university records.
