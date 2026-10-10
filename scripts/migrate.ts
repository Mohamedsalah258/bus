import { pathToFileURL } from "node:url";
import "dotenv/config";
import { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

export async function migrate(url: string) {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7310042)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const dir = resolve(process.cwd(), "migrations");
    for (const name of (await readdir(dir))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(resolve(dir, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`Applied migration ${name} was modified`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
      console.log(`Applied ${name}`);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(7310042)");
    client.release();
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  migrate(process.env.DATABASE_URL ?? "").catch(() => {
    console.error(
      "Migration failed. Check connectivity and migration files; credentials are not logged.",
    );
    process.exitCode = 1;
  });
