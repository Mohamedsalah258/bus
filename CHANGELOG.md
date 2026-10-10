# Changelog

## 0.14.0 — Stop editing and round trips

### Added

- `PUT /routes/{id}/stops`: replace a route's stop list. Removed or renamed stops are retired, never deleted, so past bookings keep their stop; removal is refused while upcoming bookings use the stop; route `version` bumps and trips record theirs. (BL-09)
- `POST /bookings/round-trip`: outbound and return booked together, all or nothing, with the failing leg named; shared `pairId`; `?withPair=true` cancels both. Trips locked in id order so concurrent round trips never deadlock. (BL-14)
- Integration test: 20 concurrent round trips on 10 + 10 seats → exactly 10 complete pairs.
- Migration `013_route_versions_round_trips.sql`.

## 0.13.0 — Administration tools

### Added

- Edit seasons (plans must stay inside), categories (rename, deactivate) and faculties (rename), audited. Completes BL-10 with the fleet and route edits from 0.7.0–0.9.0.
- Audit log filters: action, entity, actor, Cairo date range. (BL-21)
- Email change confirmed by a code to the new address, with a notice to the old one; staff edit any user's profile with a reason. (BL-33)
- Failed-email screen and retry; one-time codes are never resent. Permission `notifications:manage` (ADMIN). (BL-34)
- Self-service renewal of MFA recovery codes with a current TOTP code. (BL-35)
- Migration `012_email_change.sql`.

## 0.12.0 — Reports, news and alerts

### Added

- Reports (`/reports/*`): daily bookings, occupancy by route, bookings by faculty, subscriptions (statuses, rejection reasons, decision time), complaints (status, kind, resolution time). JSON on screen or `format=csv` for Excel; every export audited. (BL-20)
- CSV writer with BOM for Arabic, RFC 4180 quoting and formula-injection protection.
- News and service alerts (`/news`): public feed with pinned, scheduled and expiring posts and route-specific alerts; staff management. (BL-19)
- Permissions `reports:read` (DISPATCHER, AUDITOR) and `content:manage` (DISPATCHER).
- Migration `011_news.sql`.

## 0.11.0 — Group trips (student activities)

Decision D7: the transport office approves group trips.

### Added

- Group trip requests (`/group-trips`) replacing the old student-activities form: reference numbers, needs-info and resubmit, withdraw, reject, approve with one or more buses and drivers, cancel. (BL-15)
- Approval creates `GROUP` trips that hold each bus and driver for the whole outing, so they cannot be double-booked; seats must cover the group. Group trips are never public or bookable.
- Emails at every step; the approval lists each bus with its driver's contact.
- Permissions `group-trips:request` (MEMBER), `group-trips:read` (DISPATCHER, AUDITOR), `group-trips:manage` (DISPATCHER).
- Migration `010_group_trips.sql`: trips gain `kind` (`SCHEDULED` | `GROUP`); `routeId` is null for group trips.

## 0.10.0 — Complaints and suggestions

### Added

- Complaints and suggestions (`/complaints`): reference numbers, optional link to the author's trip or subscription, threaded replies, staff-only internal notes, assignment, resolve and close, reopen on author reply, daily cap. (BL-18)
- Privacy by design: only the author and complaint staff can read a complaint; anyone else gets 404 whatever the reference.
- Emails to the author on receipt, staff reply, resolution and closure (template `COMPLAINT_UPDATED`).
- Permissions `complaints:submit` (MEMBER), `complaints:read` (SUPPORT, DISPATCHER, AUDITOR), `complaints:handle` (SUPPORT, DISPATCHER). The SUPPORT role is now active.
- Migration `009_complaints.sql`.

## 0.9.0 — Route control and confirmed route data

### Added

- `PATCH /routes/{id}`: rename, close or reopen any route, audited; closing blocks new bookings, requests and generation immediately and reports upcoming trips. `GET /routes?includeInactive=true` for staff.
- `stops` in travel order on every trip in `GET /trips`: return trips run the same stops in reverse (confirmed by the transport office).
- Booking emails label the stop «محطة النزول» on return trips.

### Changed

- `data/legacy-routes.json`: plates use «أ» (و ب أ …) and the eastern route driver is «حسني حمد محمود محمد», as confirmed. Databases seeded earlier keep the old spelling; correct them with `PATCH /vehicles/{id}` and `PATCH /drivers/{id}`.

## 0.8.0 — Recurring schedules

Times, operating days and seats are staff settings, not code.

### Added

- Schedule templates (`/schedules`): Cairo departure time, duration, weekdays with a Saturday-first week, validity dates, seats, booking and cancellation cutoffs, optional bus and driver (default: the route's). (BL-11)
- `POST /schedules/{id}/generate`: creates a period's trips with a dry-run preview; skips holidays, already generated dates and passed cutoffs; reports bus/driver conflicts instead of failing. One trip per template per date, ever. DST-safe.
- Service exceptions (`/service-exceptions`) for holidays and closures.
- `PATCH /trips/{id}/capacity`: seats per trip, between its confirmed bookings and its bus capacity.
- Migration `008_schedule_templates.sql`.

### Fixed

- A flaky MFA test that regenerated a TOTP code across a 30-second boundary.

## 0.7.0 — Old-site routes

### Added

- `data/legacy-routes.json` and `npm run seed:legacy-routes`: the five routes of cars.bsu.edu.eg (الخط الغربي، الخط الشرقي، الفيوم، المنيا، خط أكتوبر) with ordered stops, dedicated bus and driver. Idempotent; placeholder seat counts are reported.
- Driver `phone`; route `defaultVehicleId` and `defaultDriverId` (`PUT /routes/{id}/defaults`) for recurring scheduling.
- `PATCH /vehicles/{id}` and `PATCH /drivers/{id}`: audited edits; retiring refused while upcoming trips or route defaults depend on it. (part of BL-10)
- Driver name and phone in `GET /bookings/mine`, for confirmed bookings on unfinished trips only.
- Migration `007_route_defaults_driver_phone.sql`.

## 0.6.0 — Old-site parity

Members get the old site's simplicity without its weaknesses: no password and no separate registration, but every action is tied to a verified email and nobody can read another person's data.

### Added

- Password-free sign-in for members: `POST /auth/code/request` and `POST /auth/code/verify`. The first verified code creates the account. Same answer for any email; staff never receive codes.
- `POST /subscriptions/apply`: the old subscription form (name, phone, job title, faculty, category, plan, route) saved and submitted in one transaction.
- `PATCH /auth/me/profile`; profile fields `phone` (Egyptian mobile, normalized) and `jobTitle`; `profileComplete` on `GET /auth/me`; applicant phone and job title in the review queue.
- Migration `006_passwordless_members.sql`: passwords and names optional for members only, sign-in codes addressed to an email.

### Changed

- `POST /subscriptions` requires a complete profile (use `/subscriptions/apply` otherwise).
- Members cannot see or be identified by a national ID anywhere; the field is not collected.

## 0.5.0 — Closing the cycles

### Added

- Trip lifecycle: draft, publish, close, reopen, start, complete, cancel — one transition table, audited, `GET /trips/schedule` and `GET /trips/{id}` for staff. (BL-12)
- Trip cancellation cancels every confirmed booking in the same transaction and emails each passenger the reason; staff can cancel a single booking (`PATCH /bookings/{id}/admin-cancel`). Booking status `CANCELLED_BY_ADMIN` with `cancelReason`. (BL-13)
- Suspending a subscription cancels its upcoming bookings with the suspension reason; lock order makes a booking in flight finish first and then be cancelled.
- Booking emails: confirmation, passenger cancellation, staff cancellation, with Cairo-time Arabic dates. (BL-17)
- Append-only payment ledger: reversal of a mistaken payment and refunds for rejected or withdrawn requests; net `paidMinor`; payment status recomputed. (BL-32)
- Migration `005_trip_lifecycle_payment_corrections.sql`.

### Changed

- `POST /trips` accepts `publish: false` to create a draft.
- Passengers may still cancel on a `CLOSED` trip until the cancellation cutoff.
- New permission `bookings:manage` (ADMIN, DISPATCHER).

## 0.4.0 — Sprint 3

Decisions D2 (all plan types), D3 (email code) and D6 (email only) implemented.

**Breaking for API clients:** `POST /subscriptions` takes `planId` instead of `seasonId`; new accounts must verify their email before using the API; subscription responses add plan, payment and lifecycle fields. Deployments must configure SMTP (`MAIL_TRANSPORT=smtp` is required in production).

### Added

- Transactional email outbox with a background dispatcher: retries with backoff, safe across instances (`SKIP LOCKED`), stale-claim recovery, codes erased after delivery. Arabic RTL templates. Mailpit in `compose.yaml` for local development. (BL-16)
- Email verification by 6-digit code (10 minutes, 5 tries, resend cooldown), password recovery by emailed code without account enumeration, optional `ALLOWED_EMAIL_DOMAINS`. (BL-05)
- Subscription plans (`/plans`): annual or term, free or paid, inside a season. (BL-08, D2)
- Subscription lifecycle with one transition table: NEEDS_INFO and resubmit, withdraw, suspend and reinstate, reapplication after rejection or withdrawal, overlap protection, `expired` flag, detail endpoint. Applicants are emailed on every staff decision. (BL-08)
- Manual payment recording with partial payments; booking opens only when paid in full. (BL-08)
- Migration `004_email_otp_outbox_plans.sql`; existing accounts are marked verified.

## 0.3.0 — Sprint 2

**Breaking for API clients:** registration requires `categoryId`; route creation requires `eligibleCategoryIds`; `POST /auth/login` may return an MFA challenge instead of tokens; `GET /subscriptions` returns review items with applicant fields. Deployments must set `MFA_ENCRYPTION_KEY`.

### Added

- Seven roles (`ADMIN`, `DISPATCHER`, `FACULTY_COORDINATOR`, `AUDITOR`, `MEMBER`, `SUPPORT`, `SUPERVISOR`) and a single permission matrix; `@RequirePermissions` replaces `@Roles`. (BL-03)
- Beneficiary categories (`/categories`) and per-route eligibility (`PUT /routes/{id}/eligible-categories`); subscription requests outside a route's categories get 403. (BL-03)
- Faculty coordinators see and review only their own faculty's applicants. Review queue filter `?status=PENDING`. (BL-03)
- User management under `/users`: create with temporary password, list and search, change role, activate/deactivate, reset password, reset MFA. All audited with a reason; no self-service on one's own account; the last active admin is protected under concurrency. (BL-04)
- `POST /auth/password`: change password; ends other sessions.
- TOTP two-factor authentication (RFC 6238, no third-party library), mandatory for ADMIN and DISPATCHER, encrypted secrets, single-use codes, 10 hashed recovery codes, per-account attempt limit. (BL-06)
- Migration `003_roles_categories_mfa.sql`.

## 0.2.0 — Sprint 1

**Breaking for API clients.** No frontend existed yet, so the contract changed in one step before any client depends on it.

### Added

- `POST /auth/refresh`: opaque, single-use, rotating refresh tokens (30 days). Replay of a used token revokes the session family and writes `REFRESH_TOKEN_REUSE_DETECTED` to the audit log. (BL-02)
- Per-email failed-login limit (5 per minute) stored in PostgreSQL, identical for known and unknown emails. (BL-01)
- `X-Request-Id` on every response, reused from a valid upstream UUID, included in error bodies; one JSON log line per request. (NFR-05)
- `TRUST_PROXY_HOPS` setting; trust proxy is off unless set explicitly. (NFR-05)
- Response DTOs for every endpoint in OpenAPI. (BL-07)
- Migration `002_auth_hardening.sql`: `refresh_tokens`, `login_throttle`.

### Changed

- All response keys are `camelCase` (`remaining_seats` → `remainingSeats`, `faculty_id` → `facultyId`, …). (BL-07)
- Lists return `{ items, total, limit, offset }` instead of a bare array. (BL-07)
- Season dates are returned as `YYYY-MM-DD` instead of a time-zone-shifted timestamp.
- `GET /trips` no longer exposes columns outside the documented summary.
- Login responses add `refreshToken` and `refreshExpiresIn`. Logout also revokes refresh tokens.
- Rate limiting: protected routes are tracked per bearer token instead of per IP, so users behind one campus NAT no longer share a bucket. Public routes stay per IP; login 100/min, register 30/min.
- Concurrency test raised to the study's target: 100 concurrent bookings for 10 seats. (NFR-01)

## 0.1.0

Initial backend foundation, then restructured into feature modules.
