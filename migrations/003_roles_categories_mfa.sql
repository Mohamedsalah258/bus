-- BL-03: staff roles, beneficiary categories, route eligibility.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN
  ('MEMBER','DISPATCHER','ADMIN','FACULTY_COORDINATOR','SUPERVISOR','SUPPORT','AUDITOR'));
ALTER TABLE users ADD CONSTRAINT users_coordinator_has_faculty
  CHECK (role <> 'FACULTY_COORDINATOR' OR faculty_id IS NOT NULL);

-- Categories are data, not code: the university's decision D1 is configured,
-- not compiled (e.g. FACULTY_MEMBER, EMPLOYEE, CONTRACTOR, STUDENT).
CREATE TABLE beneficiary_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
 name text NOT NULL UNIQUE,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN category_id uuid REFERENCES beneficiary_categories(id);

CREATE TABLE route_eligible_categories (
 route_id uuid NOT NULL REFERENCES routes(id),
 category_id uuid NOT NULL REFERENCES beneficiary_categories(id),
 PRIMARY KEY (route_id, category_id)
);

-- BL-04: staff accounts created by an administrator start with a temporary password.
ALTER TABLE users ADD COLUMN password_change_required boolean NOT NULL DEFAULT false;
CREATE INDEX users_faculty ON users(faculty_id);
CREATE INDEX users_role_active ON users(role) WHERE active;

-- BL-06: TOTP second factor. Secrets are AES-256-GCM encrypted by the API;
-- mfa_last_step blocks reuse of a code inside its 30-second window.
ALTER TABLE users
  ADD COLUMN mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN mfa_secret_enc text,
  ADD COLUMN mfa_pending_secret_enc text,
  ADD COLUMN mfa_last_step bigint,
  ADD CONSTRAINT users_mfa_secret_present CHECK (NOT mfa_enabled OR mfa_secret_enc IS NOT NULL);

CREATE TABLE mfa_recovery_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 code_hash text NOT NULL,
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id, code_hash)
);
