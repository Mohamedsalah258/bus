import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Database } from "../../database/database.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import { toPage } from "../../common/dto/page.dto.js";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { CreateSeasonDto, UpdateSeasonDto } from "./dto/create-season.dto.js";
import { SeasonsRepository } from "./seasons.repository.js";

@Injectable()
export class SeasonsService {
  constructor(
    private readonly db: Database,
    private readonly seasons: SeasonsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(page: PaginationQueryDto) {
    const { items, total } = await this.seasons.list(page);
    return toPage(items, total, page);
  }

  create(dto: CreateSeasonDto) {
    // ISO dates compare correctly as strings.
    if (dto.endsOn < dto.startsOn)
      throw new BadRequestException("Season end must follow start");
    return this.seasons.create(dto);
  }

  update(id: string, dto: UpdateSeasonDto, actorId: string) {
    return this.db.transaction(async (tx) => {
      const before = await this.seasons.lock(id, tx);
      if (!before) throw new NotFoundException();
      const next = {
        name: dto.name ?? before.name,
        startsOn: dto.startsOn ?? before.startsOn,
        endsOn: dto.endsOn ?? before.endsOn,
      };
      if (next.endsOn < next.startsOn)
        throw new BadRequestException("Season end must follow start");
      const outside = await this.seasons.plansOutside(
        id,
        next.startsOn,
        next.endsOn,
        tx,
      );
      if (outside.length)
        throw new ConflictException(
          `Plans would fall outside the season: ${outside.join(", ")}`,
        );
      const after = await this.seasons.update(id, next, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.SeasonUpdated,
        entityId: id,
        metadata: { before, after, reason: dto.reason },
      });
      return after;
    });
  }
}
