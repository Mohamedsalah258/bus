-- BL-33: changing the sign-in email. The new address must prove itself
-- with a code before it replaces the old one.
ALTER TABLE users ADD COLUMN pending_email text CHECK (pending_email = lower(pending_email));
ALTER TABLE email_otps DROP CONSTRAINT IF EXISTS email_otps_purpose_check;
ALTER TABLE email_otps ADD CONSTRAINT email_otps_purpose_check
  CHECK (purpose IN ('VERIFY_EMAIL','RESET_PASSWORD','SIGN_IN','CHANGE_EMAIL'));
