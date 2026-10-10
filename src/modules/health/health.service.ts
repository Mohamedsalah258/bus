import { Injectable } from "@nestjs/common";
import { Database } from "../../database/database.service.js";

@Injectable()
export class HealthService {
  constructor(private readonly db: Database) {}

  /** True when the database answers and migrations have been applied. */
  async isDatabaseReady() {
    try {
      await this.db.query("SELECT 1 FROM schema_migrations LIMIT 1");
      return true;
    } catch {
      return false;
    }
  }
}
