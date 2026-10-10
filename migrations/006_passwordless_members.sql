-- Members sign in with a code sent to their email, like the old site's
-- password-free forms. Passwords stay mandatory for every staff role.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_staff_have_password
  CHECK (role = 'MEMBER' OR password_hash IS NOT NULL);

-- The profile is filled in by the subscription form, not at sign-in.
ALTER TABLE users ALTER COLUMN name DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_staff_have_name
  CHECK (role = 'MEMBER' OR name IS NOT NULL);
ALTER TABLE users
  ADD COLUMN phone text CHECK (phone ~ '^01[0125][0-9]{8}$'),
  ADD COLUMN job_title text CHECK (char_length(job_title) BETWEEN 2 AND 120);

-- Sign-in codes are addressed to an email that may not have an account yet.
ALTER TABLE email_otps ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE email_otps ADD COLUMN email text CHECK (email = lower(email));
ALTER TABLE email_otps DROP CONSTRAINT IF EXISTS email_otps_purpose_check;
ALTER TABLE email_otps ADD CONSTRAINT email_otps_purpose_check
  CHECK (purpose IN ('VERIFY_EMAIL','RESET_PASSWORD','SIGN_IN'));
-- SIGN_IN codes belong to an email; every other code belongs to an account.
ALTER TABLE email_otps ADD CONSTRAINT email_otps_subject CHECK (
  (purpose = 'SIGN_IN' AND email IS NOT NULL AND user_id IS NULL)
  OR (purpose <> 'SIGN_IN' AND user_id IS NOT NULL AND email IS NULL));
CREATE INDEX email_otps_by_email ON email_otps(email, purpose) WHERE consumed_at IS NULL;
