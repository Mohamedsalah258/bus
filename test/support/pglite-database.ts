import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import type { Queryable } from "../../src/database/database.types.js";

/**
 * In-memory PostgreSQL (PGlite) exposing the same `query`/`transaction`
 * surface as `Database`. Sequential only: it cannot prove lock behaviour.
 */
export async function createPgliteDatabase() {
  const pg = new PGlite();
  // Same files, same order as scripts/migrate.ts.
  for (const name of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(await readFile(`migrations/${name}`, "utf8"));
  await pg.exec("CREATE TABLE schema_migrations(name text PRIMARY KEY)");

  const wrap = (run: (sql: string, args: unknown[]) => Promise<any>) =>
    (async (sql: string, args: unknown[] = []) => {
      const result = await run(sql, args);
      return {
        ...result,
        rowCount: result.rows.length || result.affectedRows || 0,
      };
    }) as Queryable["query"];

  const database = {
    query: wrap((sql, args) => pg.query(sql, args)),
    transaction: <T>(work: (tx: Queryable) => Promise<T>) =>
      pg.transaction((tx) =>
        work({ query: wrap((sql, args) => tx.query(sql, args)) }),
      ),
  };
  return { database, close: () => pg.close() };
}

export function useTestEnvironment() {
  process.env.JWT_SECRET = "test-only-secret-".repeat(4);
  process.env.DATABASE_URL ??= "postgresql://unused/bus_test";
  process.env.SWAGGER_ENABLED = "false";
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  // Mail stays in the outbox; tests read codes from it or drive the dispatcher.
  process.env.MAIL_TRANSPORT = "disabled";
}
