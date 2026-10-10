import { Injectable, NotFoundException } from "@nestjs/common";
import { toPage } from "../../common/dto/page.dto.js";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import { CategoriesRepository } from "./categories.repository.js";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto.js";

/**
 * Beneficiary categories (decision D1) are configuration: the university
 * defines them, and each route lists the categories that may subscribe.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly db: Database,
    private readonly categories: CategoriesRepository,
    private readonly audit: AuditService,
  ) {}

  async listActive(page: PaginationQueryDto) {
    const { items, total } = await this.categories.listActive(page);
    return toPage(items, total, page);
  }

  create(dto: CreateCategoryDto, actorId: string) {
    return this.db.transaction(async (tx) => {
      const category = await this.categories.create(dto, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.CategoryCreated,
        entityId: category.id,
        metadata: { code: category.code },
      });
      return category;
    });
  }

  update(id: string, dto: UpdateCategoryDto, actorId: string) {
    return this.db.transaction(async (tx) => {
      const category = await this.categories.update(id, dto, tx);
      if (!category) throw new NotFoundException();
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.CategoryUpdated,
        entityId: id,
        metadata: {
          name: category.name,
          active: category.active,
          reason: dto.reason,
        },
      });
      return category;
    });
  }
}
