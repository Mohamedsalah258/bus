-- BL-11: recurring schedules, fully set by staff (times, days, seats, cutoffs).
CREATE TABLE schedule_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 route_id uuid NOT NULL REFERENCES routes(id),
 name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
 direction text NOT NULL CHECK (direction IN ('OUTBOUND','RETURN')),
 -- Cairo wall-clock time; converted per date, so DST is handled by PostgreSQL.
 departure_time time NOT NULL,
 duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 720),
 -- Days the trip runs: 0 = Sunday … 6 = Saturday (PostgreSQL DOW).
 weekdays smallint[] NOT NULL CHECK (cardinality(weekdays) BETWEEN 1 AND 7
   AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
 valid_from date NOT NULL,
 valid_until date NOT NULL CHECK (valid_until >= valid_from),
 -- NULL = use the route's default bus/driver and the bus's seat count.
 vehicle_id uuid REFERENCES vehicles(id),
 driver_id uuid REFERENCES drivers(id),
 capacity integer CHECK (capacity BETWEEN 1 AND 100),
 booking_close_minutes integer NOT NULL CHECK (booking_close_minutes BETWEEN 0 AND 10080),
 cancellation_close_minutes integer NOT NULL CHECK (cancellation_close_minutes BETWEEN 0 AND 10080),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schedule_templates_route ON schedule_templates(route_id);

-- Days with no service (official holidays, closures), set by staff.
CREATE TABLE service_exceptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 service_date date NOT NULL UNIQUE,
 reason text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 200),
 created_at timestamptz NOT NULL DEFAULT now()
);

-- A template produces at most one trip per date, even after cancellation.
ALTER TABLE trips
  ADD COLUMN template_id uuid REFERENCES schedule_templates(id),
  ADD COLUMN service_date date;
CREATE UNIQUE INDEX trips_one_per_template_day ON trips(template_id, service_date)
  WHERE template_id IS NOT NULL;
