-- BL-02: rotating refresh tokens. Only a SHA-256 hash of the secret is stored.
CREATE TABLE refresh_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 family_id uuid NOT NULL,
 token_hash text NOT NULL,
 token_version integer NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 used_at timestamptz,
 revoked_at timestamptz,
 CHECK (expires_at > created_at)
);
CREATE INDEX refresh_tokens_user_active ON refresh_tokens(user_id) WHERE revoked_at IS NULL;
CREATE INDEX refresh_tokens_family ON refresh_tokens(family_id);
CREATE INDEX refresh_tokens_expiry ON refresh_tokens(expires_at);

-- BL-01: failed-login counter per normalized email, shared by every API instance.
CREATE TABLE login_throttle (
 email text PRIMARY KEY CHECK (email = lower(email)),
 failures integer NOT NULL CHECK (failures > 0),
 window_started_at timestamptz NOT NULL
);
CREATE INDEX login_throttle_window ON login_throttle(window_started_at);
