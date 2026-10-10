-- BL-16: transactional outbox. Rows are written in the same transaction as
-- the event, then delivered by a background dispatcher with retries.
CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid REFERENCES users(id),
 to_email text NOT NULL,
 template text NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}',
 -- Sensitive payloads (one-time codes) are wiped once delivery ends.
 sensitive boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz
);
CREATE INDEX notifications_due ON notifications(next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX notifications_claimed ON notifications(claimed_at) WHERE status = 'SENDING';
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);

-- BL-05 / D3: identity is proven by a one-time code sent to the email.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
-- Accounts that existed before this migration keep working.
UPDATE users SET email_verified_at = created_at;

CREATE TABLE email_otps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 purpose text NOT NULL CHECK (purpose IN ('VERIFY_EMAIL','RESET_PASSWORD')),
 code_hash text NOT NULL,
 expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_otps_active ON email_otps(user_id, purpose) WHERE consumed_at IS NULL;

-- BL-08 / D2: plans define the period (annual or term) and the fee.
CREATE TABLE subscription_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 season_id uuid NOT NULL REFERENCES seasons(id),
 name text NOT NULL,
 period text NOT NULL CHECK (period IN ('ANNUAL','TERM')),
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 -- Money in piasters (1 EGP = 100), never floating point. 0 = free.
 fee_minor integer NOT NULL CHECK (fee_minor >= 0),
 currency text NOT NULL DEFAULT 'EGP' CHECK (currency = 'EGP'),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (ends_on >= starts_on),
 UNIQUE (season_id, name)
);

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (status IN
  ('PENDING','NEEDS_INFO','APPROVED','REJECTED','SUSPENDED','WITHDRAWN'));
ALTER TABLE subscriptions
  ADD COLUMN plan_id uuid REFERENCES subscription_plans(id),
  ADD COLUMN fee_minor integer NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  ADD COLUMN payment_status text NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (payment_status IN ('NOT_REQUIRED','UNPAID','PAID')),
  ADD COLUMN applicant_note text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Reapplying after a rejection or withdrawal is allowed; two live requests
-- for the same plan and route are not.
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_season_id_route_id_key;
CREATE UNIQUE INDEX subscriptions_one_live
  ON subscriptions(user_id, plan_id, route_id)
  WHERE status IN ('PENDING','NEEDS_INFO','APPROVED','SUSPENDED');

-- Manual payment records (no payment gateway in this phase).
CREATE TABLE subscription_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES subscriptions(id),
 amount_minor integer NOT NULL CHECK (amount_minor > 0),
 method text NOT NULL CHECK (method IN ('CASH','BANK_TRANSFER','SALARY_DEDUCTION','OTHER')),
 reference text,
 paid_on date NOT NULL,
 recorded_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscription_payments_subscription ON subscription_payments(subscription_id);
