import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Pool, PoolClient } from "pg";

/**
 * Loads the old site's routes, stops, buses and drivers (data/legacy-routes.json).
 * Idempotent: existing routes, plates and drivers are reused, never duplicated.
 *
 *   npm run seed:legacy-routes -- --placeholder-capacity=50
 *
 * Unknown seat counts get the placeholder; correct them later with
 * PATCH /vehicles/{id}. Both default categories may subscribe to every route;
 * narrow it with PUT /routes/{id}/eligible-categories.
 */
interface LegacyRoute {
  legacyId: number;
  name: string;
  stops: string[];
  vehicle: { plate: string; capacity: number | null };
  driver: { name: string; phone: string | null };
}

const CATEGORIES = [
  { code: "FACULTY_MEMBER", name: "عضو هيئة تدريس" },
  { code: "EMPLOYEE", name: "موظف" },
];

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const placeholder = Number(arg("placeholder-capacity") ?? 50);
  if (!Number.isInteger(placeholder) || placeholder < 1 || placeholder > 100)
    throw new Error("--placeholder-capacity must be 1..100");
  const file = arg("file") ?? "data/legacy-routes.json";
  const data = JSON.parse(await readFile(file, "utf8")) as {
    routes: LegacyRoute[];
  };

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const report: string[] = [];
  try {
    await client.query("BEGIN");
    const categoryIds = await ensureCategories(client);
    for (const route of data.routes)
      report.push(await seedRoute(client, route, categoryIds, placeholder));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(report.join("\n"));
}

async function ensureCategories(client: PoolClient) {
  const ids: string[] = [];
  for (const c of CATEGORIES) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO beneficiary_categories(code,name) VALUES($1,$2)
       ON CONFLICT (code) DO UPDATE SET code=EXCLUDED.code RETURNING id`,
      [c.code, c.name],
    );
    ids.push(rows[0]!.id);
  }
  return ids;
}

async function seedRoute(
  client: PoolClient,
  route: LegacyRoute,
  categoryIds: string[],
  placeholder: number,
) {
  const existing = await client.query("SELECT 1 FROM routes WHERE name=$1", [
    route.name,
  ]);
  if (existing.rowCount) return `= ${route.name}: already present, skipped`;

  const capacity = route.vehicle.capacity ?? placeholder;
  const vehicle = await client.query<{ id: string }>(
    `INSERT INTO vehicles(plate,capacity) VALUES($1,$2)
     ON CONFLICT (plate) DO UPDATE SET plate=EXCLUDED.plate RETURNING id`,
    [route.vehicle.plate, capacity],
  );
  const knownDriver = await client.query<{ id: string }>(
    "SELECT id FROM drivers WHERE name=$1 AND phone IS NOT DISTINCT FROM $2",
    [route.driver.name, route.driver.phone],
  );
  const driverId =
    knownDriver.rows[0]?.id ??
    (
      await client.query<{ id: string }>(
        "INSERT INTO drivers(name,phone) VALUES($1,$2) RETURNING id",
        [route.driver.name, route.driver.phone],
      )
    ).rows[0]!.id;

  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO routes(name,default_vehicle_id,default_driver_id) VALUES($1,$2,$3) RETURNING id",
    [route.name, vehicle.rows[0]!.id, driverId],
  );
  const routeId = rows[0]!.id;
  for (const [position, stop] of route.stops.entries())
    await client.query(
      "INSERT INTO route_stops(route_id,name,position) VALUES($1,$2,$3)",
      [routeId, stop, position],
    );
  await client.query(
    "INSERT INTO route_eligible_categories(route_id,category_id) SELECT $1, unnest($2::uuid[])",
    [routeId, categoryIds],
  );
  await client.query(
    "INSERT INTO audit_events(actor_id,action,entity_id,metadata) VALUES(NULL,'ROUTE_CREATED',$1,$2)",
    [
      routeId,
      JSON.stringify({
        source: "seed:legacy-routes",
        legacyId: route.legacyId,
      }),
    ],
  );
  const seats =
    route.vehicle.capacity === null
      ? `${capacity} seats (PLACEHOLDER)`
      : `${capacity} seats`;
  return `+ ${route.name}: ${route.stops.length} stops, bus ${route.vehicle.plate} ${seats}, driver ${route.driver.name}`;
}

main().catch((error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
