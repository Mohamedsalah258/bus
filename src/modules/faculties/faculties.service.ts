import { Injectable, NotFoundException } from "@nestjs/common";
import { Database } from "../../database/database.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import { toPage } from "../../common/dto/page.dto.js";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import {
  CreateFacultyDto,
  UpdateFacultyDto,
} from "./dto/create-faculty.dto.js";
import { FacultiesRepository } from "./faculties.repository.js";

@Injectable()
export class FacultiesService {
  constructor(
    private readonly db: Database,
    private readonly faculties: FacultiesRepository,
    private readonly audit: AuditService,
  ) {}

  async list(page: PaginationQueryDto) {
    const { items, total } = await this.faculties.list(page);
    return toPage(items, total, page);
  }

  create(dto: CreateFacultyDto) {
    return this.faculties.create(dto.name);
  }

  rename(id: string, dto: UpdateFacultyDto, actorId: string) {
    return this.db.transaction(async (tx) => {
      const faculty = await this.faculties.rename(id, dto.name, tx);
      if (!faculty) throw new NotFoundException();
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.FacultyRenamed,
        entityId: id,
        metadata: { name: dto.name, reason: dto.reason },
      });
      return faculty;
    });
  }
}
