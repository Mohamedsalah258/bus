import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { toPage } from "../../common/dto/page.dto.js";
import { Database } from "../../database/database.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import {
  CreateNewsDto,
  ListNewsQueryDto,
  UpdateNewsDto,
} from "./dto/news.dto.js";
import { NewsRepository } from "./news.repository.js";

/** BL-19. Public news and service alerts; staff publish, schedule, pin and hide. */
@Injectable()
export class NewsService {
  constructor(
    private readonly db: Database,
    private readonly news: NewsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListNewsQueryDto, includeHidden: boolean) {
    const { items, total } = await this.news.list(q, includeHidden);
    return toPage(items, total, q);
  }

  async get(id: string) {
    const post = await this.news.findVisible(id);
    if (!post) throw new NotFoundException();
    return post;
  }

  create(dto: CreateNewsDto, actorId: string) {
    this.assertWindow(dto.publishedAt, dto.expiresAt);
    return this.db.transaction(async (tx) => {
      const post = await this.news.create(dto, actorId, tx);
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.NewsPublished,
        entityId: post.id,
        metadata: { kind: post.kind },
      });
      return post;
    });
  }

  update(id: string, dto: UpdateNewsDto, actorId: string) {
    this.assertWindow(dto.publishedAt, dto.expiresAt);
    return this.db.transaction(async (tx) => {
      const post = await this.news.update(id, dto, tx);
      if (!post) throw new NotFoundException();
      await this.audit.record(tx, {
        actorId,
        action: AuditAction.NewsUpdated,
        entityId: id,
        metadata: { changed: Object.keys(dto) },
      });
      return post;
    });
  }

  private assertWindow(publishedAt?: string, expiresAt?: string) {
    if (
      publishedAt &&
      expiresAt &&
      Date.parse(expiresAt) <= Date.parse(publishedAt)
    )
      throw new BadRequestException("expiresAt must be after publishedAt");
  }
}
