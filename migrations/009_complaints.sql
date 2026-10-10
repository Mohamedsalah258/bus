-- BL-18: complaints and suggestions, tied to a verified account.
-- Replaces the old "follow a complaint by its number" page: only the author
-- and staff can read a complaint, whatever its reference.
CREATE SEQUENCE complaint_reference_seq;

CREATE TABLE complaints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reference text NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK (kind IN ('COMPLAINT','SUGGESTION')),
 subject text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 150),
 status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
 trip_id uuid REFERENCES trips(id),
 subscription_id uuid REFERENCES subscriptions(id),
 assigned_to uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 closed_at timestamptz
);
CREATE INDEX complaints_user ON complaints(user_id, created_at DESC);
CREATE INDEX complaints_queue ON complaints(status, created_at) WHERE status IN ('OPEN','IN_PROGRESS');

CREATE TABLE complaint_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 complaint_id uuid NOT NULL REFERENCES complaints(id),
 author_id uuid NOT NULL REFERENCES users(id),
 from_staff boolean NOT NULL,
 -- Internal notes are visible to staff only, never to the author.
 internal boolean NOT NULL DEFAULT false CHECK (NOT internal OR from_staff),
 body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX complaint_messages_thread ON complaint_messages(complaint_id, created_at);
