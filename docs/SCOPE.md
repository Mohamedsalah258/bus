# Implementation scope — 0.6.0

## Decisions

- A new backend, not a migration of the inaccessible legacy administration system.
- Node.js 24, NestJS and TypeScript; PostgreSQL with versioned, checksummed SQL migrations.
- Native `pg` parameterized queries. No ORM schema synchronization and no automatic destructive migrations.
- One university and one modular application. No multi-tenant, payments, GPS or mobile delivery in this slice.
- Members sign in with an emailed code, no password (decided 2026-10-09 to match the old site's simplicity). Staff always use password + MFA and never receive sign-in codes. Eligibility is verified at subscription review, as the study allows for the first phase.
- Public registration only grants `MEMBER`. Staff accounts are created by an administrator with a temporary password that must be changed before use.
- Access is decided by permissions, never by role checks in controllers. Seven roles map to permissions in one file. Faculty coordinators are additionally limited to their own faculty in the service layer.
- Beneficiary categories (decision D1) are configuration, not code. A self-declared category only decides which routes a member may _request_; an administrator still verifies eligibility before approval.
- ADMIN and DISPATCHER must use TOTP. Secrets are AES-256-GCM encrypted with `MFA_ENCRYPTION_KEY`; codes are single-use; recovery codes are stored hashed.
- Email is a login identifier, **not verified identity**. An administrator must establish eligibility before approving subscriptions. Production launch requires a chosen email/SSO verification and account-recovery flow.
- Decisions taken on 2026-10-08: **D2** every plan type is supported (annual or term, free or paid); **D3** identity is proven by a code sent to the email; **D6** email is the only notification channel.
- A subscription covers one route for one plan's dates (`Africa/Cairo`). Only `APPROVED` and paid (or free) subscriptions can book. Reapplication after rejection or withdrawal is allowed.
- Payments are recorded manually by staff; there is no payment gateway, refund or settlement in this phase (phase C).
- Email goes through a transactional outbox with retries; one-time codes are keyed-hashed at rest and erased from the outbox after delivery.
- Each trip has a vehicle, driver, direction, zoned departure/arrival, booking cutoff, cancellation cutoff and capacity. Inputs must contain `Z` or an explicit UTC offset.
- A seat occupies the whole trip; no seat numbers or reuse between stops. Direction is displayed; stop order is stored as outbound order and a future UI can reverse it for return travel.
- Trips follow an audited lifecycle (draft, published, closed, in progress, completed, cancelled). Cancelling a trip or suspending a subscription cancels the affected bookings with a reason and emails each passenger. Rescheduling a trip, editing routes and resources, and replacing vehicles remain separate workflows (BL-10, BL-30).
- Vehicle/driver overlap uses the supplied trip interval. Preparation/turnaround buffers and duty-hour policies are not inferred; they need operational confirmation.
- Ordinary reservations have no payment or approval step after confirming eligibility and capacity.
- Cancellation is owner-only and before the trip's cutoff. It is idempotent. A cancelled reservation remains historical; a new booking requires a fresh idempotency key.
- A user cannot confirm overlapping journeys. Authentication and authorization use current database role, active flag and token version.
- Pagination is `limit` (default 25, maximum 100) and `offset`; lists return `{ items, total, limit, offset }`. All request and response keys are `camelCase`; every response shape is a documented DTO in OpenAPI.

## Concurrency guarantees and assumptions

The application is the sole writer to reservations. A booking transaction locks the user, checks an existing idempotency key, then locks the trip, checks cutoff, eligibility, stop, user overlap and current confirmed count, then inserts the booking and audit event. Independent bookings on the same trip serialize on the trip row. A partial unique database index also rejects duplicate active user/trip reservations.

Cancellation takes the user and trip locks in the same order. Vehicle assignment takes vehicle then driver locks, followed by an overlap query. No resource-update endpoints can bypass those locks in this slice; future writers must follow the same protocol. The database unique indexes alone do not enforce capacity for arbitrary direct SQL writes.

JWT access tokens expire after 15 minutes. Refresh tokens (30 days) are opaque, single-use and rotated; only a SHA-256 hash is stored, and replaying a used one revokes its session family. Logout increments the token version and revokes all refresh tokens. Failed logins are limited per email in PostgreSQL. Password recovery and email verification remain open (BL-05). No tokens, credentials, national IDs or raw SQL errors are written to audit events.

## Validation evidence

- `npm test`: configuration/password/DTO tests and an HTTP workflow against an in-memory PGlite database, using the actual PostgreSQL schema and service queries.
- `npm run test:integration`: real PostgreSQL connections; concurrent assignments, 20 contenders for 2 seats, repeated identical requests, and migration replay. Requires `TEST_DATABASE_URL`; otherwise it is skipped.
- CI includes a PostgreSQL 17 service. An added workflow is not evidence that remote CI passed; inspect its run after pushing.

## Before production

1. Agree eligibility verification, registration/recovery, season/cancellation rules and operational owners.
2. Complete staff user management and resource/route/trip lifecycle, including service outages and administrative cancellation.
3. Introduce email/SSO identity verification, stronger admin authentication, and the required notification channels.
4. Confirm actual PostgreSQL concurrency tests in CI, then realistic load and security/access-control review.
5. Implement deployment, TLS, backups and restore test, private monitoring, secret rotation and incident response.
6. Set `TRUST_PROXY_HOPS` to the real number of proxies. The per-email login limit is shared through PostgreSQL; the general per-request limiter is still in memory per instance, so multiple replicas need a shared store (NFR-02).
7. Approve personal data and audit retention rules; add operational observability without logging sensitive payloads.
8. Conduct a controlled pilot with representative administrators and users before migrating real reservations.

## Next slices

1. Account verification/recovery and audited user/resource lifecycle.
2. Administrative trip cancellation and notification outbox, then waitlist promotion with expiry.
3. QR boarding and assigned driver/supervisor access.
4. Group travel requests and approval workflow.
5. Complaints, operating reports and maintenance.

GPS, financial integrations, native applications and legacy migration remain separately scoped.
