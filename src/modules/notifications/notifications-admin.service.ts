import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { toPage } from "../../common/dto/page.dto.js";
import { Database } from "../../database/database.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import { ListNotificationsQueryDto } from "./dto/notification.dto.js";
import { NotificationsRepository } from "./notifications.repository.js";

/** BL-34: staff view of deliveries and manual retry. */
@Injectable()
export class NotificationsAdminService {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListNotificationsQueryDto) {
    const { items, total } = await this.notifications.list(q);
    return toPage(items, total, q);
  }

  /** One-time codes cannot be resent (they were erased): the user asks for a new one. */
  async retry(id: string, actorId: string) {
    const outcome = await this.notifications.retry(id);
    if (outcome === "missing") throw new NotFoundException();
    if (outcome === "sensitive")
      throw new ConflictException(
        "One-time codes are erased; the user must request a new code",
      );
    if (outcome === "not-failed")
      throw new ConflictException("Only failed notifications can be retried");
    await this.db.transaction((tx) =>
      this.audit.record(tx, {
        actorId,
        action: AuditAction.NotificationRetried,
        entityId: id,
      }),
    );
  }
}
