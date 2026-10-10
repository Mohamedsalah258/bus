import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { toPage } from "../../common/dto/page.dto.js";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Database } from "../../database/database.service.js";
import { Queryable } from "../../database/database.types.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import { AuthenticatedUser } from "../auth/auth.types.js";
import { hasPermissions, Permission } from "../auth/permissions.js";
import { NotificationTemplate } from "../notifications/notification-template.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { UserRole } from "../users/user-role.js";
import {
  canComplaintTransition,
  COMPLAINT_TRANSITIONS,
  ComplaintStatus,
  ComplaintTransition,
  MAX_COMPLAINTS_PER_DAY,
} from "./complaint-status.js";
import { ComplaintsRepository } from "./complaints.repository.js";
import {
  ComplaintDetailResponse,
  ComplaintMessageDto,
  ComplaintStaffItemResponse,
  CreateComplaintDto,
  ListComplaintsQueryDto,
} from "./dto/complaint.dto.js";

type ComplaintEvent = "RECEIVED" | "REPLIED" | "RESOLVED" | "CLOSED";

/**
 * BL-18. Only the author and complaint staff can read a complaint; the
 * reference number alone opens nothing. Every status change is audited and
 * the author is emailed whenever staff answer.
 */
@Injectable()
export class ComplaintsService {
  constructor(
    private readonly db: Database,
    private readonly complaints: ComplaintsRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  create(user: AuthenticatedUser, dto: CreateComplaintDto) {
    return this.db.transaction(async (tx) => {
      if (
        (await this.complaints.filedSince24h(user.id, tx)) >=
        MAX_COMPLAINTS_PER_DAY
      )
        throw new HttpException(
          "Too many complaints today. Add to an existing one instead.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      if (
        dto.tripId &&
        !(await this.complaints.ownsTrip(user.id, dto.tripId, tx))
      )
        throw new BadRequestException("Link a trip you booked");
      if (
        dto.subscriptionId &&
        !(await this.complaints.ownsSubscription(
          user.id,
          dto.subscriptionId,
          tx,
        ))
      )
        throw new BadRequestException("Link one of your subscriptions");
      const id = await this.complaints.insert(user.id, dto, tx);
      await this.complaints.addMessage(id, user.id, false, dto.body, false, tx);
      await this.audit.record(tx, {
        actorId: user.id,
        action: AuditAction.ComplaintFiled,
        entityId: id,
        metadata: { kind: dto.kind },
      });
      const complaint = (await this.complaints.find(id, tx))!;
      await this.notify(complaint, "RECEIVED", null, tx);
      return this.detail(complaint, false, tx);
    });
  }

  async get(id: string, viewer: AuthenticatedUser) {
    const complaint = await this.complaints.find(id);
    const access = this.access(complaint, viewer);
    return this.detail(complaint!, access === "staff");
  }

  /** The author replies (reopening a resolved complaint) or staff answer. */
  addMessage(id: string, viewer: AuthenticatedUser, dto: ComplaintMessageDto) {
    return this.db.transaction(async (tx) => {
      const complaint = await this.complaints.lock(id, tx);
      const access = this.access(complaint, viewer, "write");
      if (complaint!.status === ComplaintStatus.Closed)
        throw new ConflictException("This complaint is closed; file a new one");
      const internal = access === "staff" && Boolean(dto.internal);
      if (dto.internal && access !== "staff")
        throw new BadRequestException("Only staff can add internal notes");
      await this.complaints.addMessage(
        id,
        viewer.id,
        access === "staff",
        dto.body,
        internal,
        tx,
      );

      if (access === "owner" && complaint!.status === ComplaintStatus.Resolved)
        await this.move(complaint!, "reopen", viewer.id, tx);
      if (access === "staff" && !internal) {
        if (complaint!.status === ComplaintStatus.Open) {
          await this.complaints.assign(
            id,
            complaint!.assignedTo ?? viewer.id,
            tx,
          );
          await this.move(complaint!, "assign", viewer.id, tx);
        }
        await this.notify(complaint!, "REPLIED", dto.body, tx);
      }
      return this.detail(
        (await this.complaints.find(id, tx))!,
        access === "staff",
        tx,
      );
    });
  }

  assign(id: string, assigneeId: string, staff: AuthenticatedUser) {
    return this.db.transaction(async (tx) => {
      const complaint = await this.complaints.lock(id, tx);
      if (!complaint) throw new NotFoundException();
      const assignee = await this.complaints.staffRole(assigneeId, tx);
      if (
        !assignee?.active ||
        !hasPermissions(assignee.role as UserRole, [
          Permission.ComplaintsHandle,
        ])
      )
        throw new BadRequestException(
          "Assign to an active staff member who handles complaints",
        );
      this.assertTransition("assign", complaint.status);
      await this.complaints.assign(id, assigneeId, tx);
      await this.move(complaint, "assign", staff.id, tx, { assigneeId });
      return this.detail((await this.complaints.find(id, tx))!, true, tx);
    });
  }

  resolve(id: string, message: string, staff: AuthenticatedUser) {
    return this.db.transaction(async (tx) => {
      const complaint = await this.complaints.lock(id, tx);
      if (!complaint) throw new NotFoundException();
      this.assertTransition("resolve", complaint.status);
      await this.complaints.addMessage(id, staff.id, true, message, false, tx);
      if (!complaint.assignedTo) await this.complaints.assign(id, staff.id, tx);
      await this.move(complaint, "resolve", staff.id, tx);
      await this.notify(complaint, "RESOLVED", message, tx);
      return this.detail((await this.complaints.find(id, tx))!, true, tx);
    });
  }

  close(id: string, viewer: AuthenticatedUser) {
    return this.db.transaction(async (tx) => {
      const complaint = await this.complaints.lock(id, tx);
      const access = this.access(complaint, viewer, "write");
      this.assertTransition("close", complaint!.status);
      await this.move(complaint!, "close", viewer.id, tx);
      if (access === "staff") await this.notify(complaint!, "CLOSED", null, tx);
      return this.detail(
        (await this.complaints.find(id, tx))!,
        access === "staff",
        tx,
      );
    });
  }

  async listMine(userId: string, page: PaginationQueryDto) {
    const { items, total } = await this.complaints.listByUser(userId, page);
    return toPage(items, total, page);
  }

  async listForStaff(query: ListComplaintsQueryDto) {
    const { items, total } = await this.complaints.listForStaff(query);
    return toPage(items, total, query);
  }

  /**
   * "owner" for the author, "staff" for complaint staff; anyone else gets
   * 404 so that guessing a reference or id reveals nothing.
   */
  private access(
    complaint: ComplaintStaffItemResponse | undefined,
    viewer: AuthenticatedUser,
    mode: "read" | "write" = "read",
  ): "owner" | "staff" {
    if (!complaint) throw new NotFoundException();
    const needed =
      mode === "write"
        ? Permission.ComplaintsHandle
        : Permission.ComplaintsRead;
    if (hasPermissions(viewer.role, [needed])) return "staff";
    if (complaint.userId === viewer.id) return "owner";
    throw new NotFoundException();
  }

  private async move(
    complaint: ComplaintStaffItemResponse,
    name: ComplaintTransition,
    actorId: string,
    tx: Queryable,
    extra: Record<string, unknown> = {},
  ) {
    const to = COMPLAINT_TRANSITIONS[name].to;
    await this.complaints.setStatus(complaint.id, to, tx);
    await this.audit.record(tx, {
      actorId,
      action: AuditAction.ComplaintStatusChanged,
      entityId: complaint.id,
      metadata: { action: name, from: complaint.status, to, ...extra },
    });
    complaint.status = to;
  }

  private assertTransition(name: ComplaintTransition, from: ComplaintStatus) {
    if (!canComplaintTransition(name, from))
      throw new ConflictException(`Cannot ${name} a complaint that is ${from}`);
  }

  private notify(
    c: ComplaintStaffItemResponse,
    event: ComplaintEvent,
    message: string | null,
    tx: Queryable,
  ) {
    return this.notifications.send(
      tx,
      { userId: c.userId, email: c.authorEmail },
      NotificationTemplate.ComplaintUpdated,
      {
        name: c.authorName ?? "",
        reference: c.reference,
        subject: c.subject,
        event,
        message,
      },
    );
  }

  private async detail(
    c: ComplaintStaffItemResponse,
    includeInternal: boolean,
    tx?: Queryable,
  ): Promise<ComplaintDetailResponse> {
    return {
      ...c,
      messages: await this.complaints.messages(c.id, includeInternal, tx),
    };
  }
}
