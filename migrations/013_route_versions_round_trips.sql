-- BL-09: stops are never edited or deleted. A removed or renamed stop is
-- retired and a new row takes its place, so past bookings keep the exact
-- stop they used. Each change of the stop list bumps the route's version.
ALTER TABLE route_stops ADD COLUMN retired_at timestamptz;
ALTER TABLE route_stops DROP CONSTRAINT IF EXISTS route_stops_route_id_position_key;
CREATE UNIQUE INDEX route_stops_active_position ON route_stops(route_id, position) WHERE retired_at IS NULL;
ALTER TABLE routes ADD COLUMN version integer NOT NULL DEFAULT 1;
-- The stop-list version a trip was planned with.
ALTER TABLE trips ADD COLUMN route_version integer;
UPDATE trips SET route_version = 1 WHERE route_id IS NOT NULL;

-- BL-14: the two legs of a round trip share a pair id.
ALTER TABLE bookings ADD COLUMN pair_id uuid;
CREATE INDEX bookings_pair ON bookings(pair_id) WHERE pair_id IS NOT NULL;
