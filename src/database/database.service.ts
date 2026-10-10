import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, QueryResultRow } from "pg";
import { APP_CONFIG, AppConfig } from "../config/app-config.js";
import { Queryable } from "./database.types.js";

@Injectable()
export class Database implements Queryable, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, "databaseUrl">) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
    });
  }

  query<T extends QueryResultRow = any>(sql: string, params: unknown[] = []) {
    return this.pool.query<T>(sql, params);
  }

  /** Runs `work` inside BEGIN/COMMIT; any thrown error rolls back. */
  async transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
