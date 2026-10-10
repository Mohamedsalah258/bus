-- BL-15 / D7: group trip requests (student activities), approved by the
-- transport office. Replaces the old «حجز رحلة (الأنشطة الطلابية)» form.
CREATE SEQUENCE group_trip_reference_seq;

CREATE TABLE group_trip_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reference text NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES users(id),
 organization text NOT NULL CHECK (char_length(organization) BETWEEN 2 AND 150),
 purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 3 AND 300),
 destination text NOT NULL CHECK (char_length(destination) BETWEEN 2 AND 200),
 details text CHECK (char_length(details) <= 4000),
 pickup_location text NOT NULL CHECK (char_length(pickup_location) BETWEEN 2 AND 200),
 passengers integer NOT NULL CHECK (passengers BETWEEN 1 AND 500),
 departure_at timestamptz NOT NULL,
 return_at timestamptz NOT NULL CHECK (return_at > departure_at),
 status text NOT NULL DEFAULT 'PENDING'
   CHECK (status IN ('PENDING','NEEDS_INFO','APPROVED','REJECTED','WITHDRAWN','CANCELLED')),
 decision_reason text,
 decided_by uuid REFERENCES users(id),
 decided_at timestamptz,
 applicant_note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_trip_requests_user ON group_trip_requests(user_id, created_at DESC);
CREATE INDEX group_trip_requests_queue ON group_trip_requests(status, departure_at)
  WHERE status IN ('PENDING','NEEDS_INFO');

-- Approved requests become GROUP trips: they hold a bus and driver for the
-- whole outing (so nothing else can use them) and are never publicly bookable.
ALTER TABLE trips ADD COLUMN kind text NOT NULL DEFAULT 'SCHEDULED' CHECK (kind IN ('SCHEDULED','GROUP'));
ALTER TABLE trips ALTER COLUMN route_id DROP NOT NULL;
ALTER TABLE trips ADD CONSTRAINT trips_scheduled_have_route CHECK (kind = 'GROUP' OR route_id IS NOT NULL);
ALTER TABLE trips ADD COLUMN group_request_id uuid REFERENCES group_trip_requests(id);
ALTER TABLE trips ADD CONSTRAINT trips_group_have_request
  CHECK ((kind = 'GROUP') = (group_request_id IS NOT NULL));
CREATE INDEX trips_group_request ON trips(group_request_id) WHERE group_request_id IS NOT NULL;
