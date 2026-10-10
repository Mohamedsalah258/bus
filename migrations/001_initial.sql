CREATE TABLE faculties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
 name text NOT NULL, password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'MEMBER' CHECK(role IN ('MEMBER','DISPATCHER','ADMIN')),
 faculty_id uuid REFERENCES faculties(id), active boolean NOT NULL DEFAULT true,
 token_version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(email=lower(email))
);
CREATE TABLE seasons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
 starts_on date NOT NULL, ends_on date NOT NULL, CHECK(ends_on>=starts_on)
);
CREATE TABLE routes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE route_stops (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), route_id uuid NOT NULL REFERENCES routes(id),
 name text NOT NULL, position integer NOT NULL CHECK(position>=0), UNIQUE(route_id,position)
);
CREATE TABLE vehicles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plate text NOT NULL UNIQUE,
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 100), active boolean NOT NULL DEFAULT true
);
CREATE TABLE drivers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 season_id uuid NOT NULL REFERENCES seasons(id), route_id uuid NOT NULL REFERENCES routes(id),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, review_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,season_id,route_id)
);
CREATE TABLE trips (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), route_id uuid NOT NULL REFERENCES routes(id),
 vehicle_id uuid NOT NULL REFERENCES vehicles(id), driver_id uuid NOT NULL REFERENCES drivers(id),
 direction text NOT NULL CHECK(direction IN ('OUTBOUND','RETURN')),
 departure_at timestamptz NOT NULL, arrival_at timestamptz NOT NULL,
 booking_closes_at timestamptz NOT NULL, cancellation_closes_at timestamptz NOT NULL,
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'PUBLISHED' CHECK(status IN ('PUBLISHED','CANCELLED','COMPLETED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(arrival_at>departure_at), CHECK(booking_closes_at<=departure_at), CHECK(cancellation_closes_at<=departure_at)
);
CREATE TABLE bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 trip_id uuid NOT NULL REFERENCES trips(id), boarding_stop_id uuid NOT NULL REFERENCES route_stops(id),
 status text NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED','CANCELLED')),
 idempotency_key uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), cancelled_at timestamptz,
 UNIQUE(user_id,idempotency_key)
);
CREATE UNIQUE INDEX one_active_booking ON bookings(user_id,trip_id) WHERE status='CONFIRMED';
CREATE INDEX bookings_trip_status ON bookings(trip_id,status);
CREATE INDEX bookings_user ON bookings(user_id,created_at DESC);
CREATE INDEX trips_departure ON trips(departure_at);
CREATE INDEX trips_vehicle_time ON trips(vehicle_id,departure_at,arrival_at);
CREATE INDEX trips_driver_time ON trips(driver_id,departure_at,arrival_at);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id),
 action text NOT NULL, entity_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 metadata jsonb NOT NULL DEFAULT '{}'
);
