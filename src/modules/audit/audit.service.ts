import { Injectable } from "@nestjs/common";
import { toPage } from "../../common/dto/page.dto.js";
import { ListAuditQueryDto } from "./dto/list-audit-query.dto.js";
import { Queryable } from "../../database/database.types.js";
import { AuditEntry, AuditRepository } from "./audit.repository.js";

@Injectable()
export class AuditService {
  constructor(private readonly audit: AuditRepository) {}

  /** Records inside the caller's transaction so the event commits with the change. */
  record(tx: Queryable, entry: AuditEntry) {
    return this.audit.insert(entry, tx);
  }

  async list(query: ListAuditQueryDto) {
    const { items, total } = await this.audit.list(query);
    return toPage(items, total, query);
  }
}
