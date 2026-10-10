-- Each route on the old site has a dedicated bus and driver. Recording them
-- on the route lets recurring scheduling (BL-11) assign trips by default.
ALTER TABLE drivers ADD COLUMN phone text CHECK (phone ~ '^01[0125][0-9]{8}$');
ALTER TABLE routes
  ADD COLUMN default_vehicle_id uuid REFERENCES vehicles(id),
  ADD COLUMN default_driver_id uuid REFERENCES drivers(id),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE vehicles ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE drivers ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
