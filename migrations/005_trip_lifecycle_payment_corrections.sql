-- BL-12: trip lifecycle.
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_status_check;
ALTER TABLE trips ADD CONSTRAINT trips_status_check CHECK (status IN
  ('DRAFT','PUBLISHED','CLOSED','IN_PROGRESS','COMPLETED','CANCELLED'));
ALTER TABLE trips
  ADD COLUMN cancel_reason text,
  ADD COLUMN cancelled_by uuid REFERENCES users(id),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT trips_cancel_has_reason CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL);
CREATE INDEX trips_status_departure ON trips(status, departure_at);

-- BL-13: cancellations by the administration are distinct from the passenger's own.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN
  ('CONFIRMED','CANCELLED','CANCELLED_BY_ADMIN'));
ALTER TABLE bookings
  ADD COLUMN cancel_reason text,
  ADD COLUMN cancelled_by uuid REFERENCES users(id),
  ADD CONSTRAINT bookings_admin_cancel_has_reason
    CHECK (status <> 'CANCELLED_BY_ADMIN' OR cancel_reason IS NOT NULL);

-- BL-32: payments are never edited or deleted. A mistake is corrected by a
-- REVERSAL row pointing at it; money handed back is a REFUND row.
ALTER TABLE subscription_payments
  ADD COLUMN kind text NOT NULL DEFAULT 'PAYMENT' CHECK (kind IN ('PAYMENT','REVERSAL','REFUND')),
  ADD COLUMN reverses_payment_id uuid REFERENCES subscription_payments(id),
  ADD COLUMN reason text,
  ADD CONSTRAINT payments_reversal_shape CHECK (
    (kind = 'REVERSAL') = (reverses_payment_id IS NOT NULL)
    AND (kind = 'PAYMENT' OR reason IS NOT NULL));
CREATE UNIQUE INDEX payments_reversed_once
  ON subscription_payments(reverses_payment_id) WHERE kind = 'REVERSAL';
