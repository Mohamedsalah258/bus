import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { BookingNotifier } from "../bookings/booking-notifier.js";
import { BookingsRepository } from "../bookings/bookings.repository.js";
import { hasPermissions, Permission } from "../auth/permissions.js";
import { NotificationTemplate } from "../notifications/notification-template.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PlansRepository } from "../plans/plans.repository.js";
import { UserRole } from "../users/user-role.js";
import { CategoriesRepository } from "../categories/categories.repository.js";
import { UsersRepository } from "../users/users.repository.js";
import { ApplySubscriptionDto } from "./dto/apply-subscription.dto.js";
import { CreateSubscriptionDto } from "./dto/create-subscription.dto.js";
import { ListSubscriptionsQueryDto } from "./dto/list-subscriptions-query.dto.js";
import {
  RecordPaymentDto,
  RecordRefundDto,
  ReviewSubscriptionDto,
} from "./dto/review-subscription.dto.js";
import {
  SubscriptionDetailResponse,
  SubscriptionReviewItemResponse,
} from "./dto/subscription.response.js";
import {
  canTransition,
  PaymentStatus,
  SubscriptionStatus,
  TransitionName,
} from "./subscription-status.js";
import { SubscriptionsRepository } from "./subscriptions.repository.js";

const STAFF_AUDIT: Record<"review" | "suspend" | "reinstate", AuditAction> = {
  review: AuditAction.SubscriptionReviewed,
  suspend: AuditAction.SubscriptionSuspended,
  reinstate: AuditAction.SubscriptionReinstated,
};

/**
 * A subscription grants eligibility to book on one route for one plan's
 * dates. It never reserves a seat. Paid plans open booking only once paid.
 * Every status change goes through TRANSITIONS in subscription-status.ts.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly db: Database,
    private readonly subscriptions: SubscriptionsRepository,
    private readonly plans: PlansRepository,
    private readonly users: UsersRepository,
    private readonly categories: CategoriesRepository,
    private readonly notifications: NotificationsService,
    private readonly bookings: BookingsRepository,
    private readonly bookingNotifier: BookingNotifier,
    private readonly audit: AuditService,
  ) {}

  /** For members whose profile is already complete. */
  request(dto: CreateSubscriptionDto, user: AuthenticatedUser) {
    if (!user.profileComplete)
      throw new BadRequestException(
        "Complete your name, phone, faculty and category first (or use POST /subscriptions/apply)",
      );
    return this.db.transaction((tx) => this.requestInTx(dto, user.id, tx));
  }

  /**
   * The single form of the old site: saves the profile and submits the
   * request in one transaction, so a refused request leaves nothing behind.
   */
  async apply(dto: ApplySubscriptionDto, user: AuthenticatedUser) {
    if (!(await this.categories.allActive([dto.categoryId])))
      throw new BadRequestException("Unknown or inactive category");
    return this.db.transaction(async (tx) => {
      await this.subscriptions.lockApplicant(user.id, tx);
      const before = await this.users.updateProfile(
        user.id,
        {
          name: dto.name,
          phone: dto.phone,
          jobTitle: dto.jobTitle ?? null,
          facultyId: dto.facultyId,
          categoryId: dto.categoryId,
        },
        tx,
      );
      if (
        (before.previousFacultyId &&
          before.previousFacultyId !== dto.facultyId) ||
        (before.previousCategoryId &&
          before.previousCategoryId !== dto.categoryId)
      )
        await this.audit.record(tx, {
          actorId: user.id,
          action: AuditAction.ProfileScopeChanged,
          entityId: user.id,
          metadata: {
            facultyId: { from: before.previousFacultyId, to: dto.facultyId },
            categoryId: { from: before.previousCategoryId, to: dto.categoryId },
          },
        });
      return this.requestInTx(
        { planId: dto.planId, routeId: dto.routeId },
        user.id,
        tx,
      );
    });
  }

  private async requestInTx(
    dto: CreateSubscriptionDto,
    userId: string,
    tx: Queryable,
  ) {
    await this.subscriptions.lockApplicant(userId, tx);
    const plan = await this.plans.lockOpen(dto.planId, tx);
    if (!plan || !(await this.subscriptions.isRouteActive(dto.routeId, tx)))
      throw new BadRequestException("Choose an open plan and an active route");
    if (!(await this.subscriptions.isCategoryEligible(userId, dto.routeId, tx)))
      throw new ForbiddenException(
        "Your beneficiary category is not eligible for this route",
      );
    if (
      await this.subscriptions.hasOverlappingLive(
        userId,
        dto.routeId,
        plan.startsOn,
        plan.endsOn,
        tx,
      )
    )
      throw new ConflictException(
        "You already have a subscription covering these dates on this route",
      );
    const id = await this.subscriptions.insert(userId, plan, dto.routeId, tx);
    await this.audit.record(tx, {
      actorId: userId,
      action: AuditAction.SubscriptionRequested,
      entityId: id,
      metadata: { planId: plan.id, feeMinor: plan.feeMinor },
    });
    return (await this.subscriptions.findReviewItem(id, tx))!;
  }

  review(id: string, dto: ReviewSubscriptionDto, reviewer: AuthenticatedUser) {
    return this.staffTransition("review", id, dto.status, dto.reason, reviewer);
  }

  suspend(id: string, reason: string, staff: AuthenticatedUser) {
    return this.staffTransition(
      "suspend",
      id,
      SubscriptionStatus.Suspended,
      reason,
      staff,
    );
  }

  reinstate(id: string, reason: string, staff: AuthenticatedUser) {
    return this.staffTransition(
      "reinstate",
      id,
      SubscriptionStatus.Approved,
      reason,
      staff,
    );
  }

  /** The applicant answers a NEEDS_INFO request; it returns to the queue. */
  resubmit(id: string, note: string, userId: string) {
    return this.ownerTransition(
      "resubmit",
      id,
      SubscriptionStatus.Pending,
      note,
      userId,
      AuditAction.SubscriptionResubmitted,
    );
  }

  withdraw(id: string, userId: string) {
    return this.ownerTransition(
      "withdraw",
      id,
      SubscriptionStatus.Withdrawn,
      null,
      userId,
      AuditAction.SubscriptionWithdrawn,
    );
  }

  /**
   * Records a manual payment (no gateway in this phase). Overpayment is
   * refused; reaching the full fee opens booking.
   */
  recordPayment(id: string, dto: RecordPaymentDto, staff: AuthenticatedUser) {
    return this.db.transaction(async (tx) => {
      const subscription = await this.subscriptions.lockReviewItem(id, tx);
      if (!subscription) throw new NotFoundException();
      if (
        subscription.status === SubscriptionStatus.Rejected ||
        subscription.status === SubscriptionStatus.Withdrawn
      )
        throw new ConflictException(
          "Payments cannot be recorded for a closed request",
        );
      if (subscription.paymentStatus !== PaymentStatus.Unpaid)
        throw new ConflictException("Nothing is due on this subscription");
      const outstanding = subscription.feeMinor - subscription.paidMinor;
      if (dto.amountMinor > outstanding)
        throw new BadRequestException(
          `Amount exceeds the outstanding ${outstanding} piasters`,
        );
      if (await this.subscriptions.isFutureDate(dto.paidOn, tx))
        throw new BadRequestException("paidOn cannot be in the future");

      await this.subscriptions.insertPayment(
        id,
        { kind: "PAYMENT", ...dto },
        staff.id,
        tx,
      );
      const paidInFull = dto.amountMinor === outstanding;
      if (paidInFull)
        await this.subscriptions.setPaymentStatus(id, PaymentStatus.Paid, tx);
      await this.audit.record(tx, {
        actorId: staff.id,
        action: AuditAction.SubscriptionPaymentRecorded,
        entityId: id,
        metadata: {
          amountMinor: dto.amountMinor,
          method: dto.method,
          paidInFull,
        },
      });
      await this.notifications.send(
        tx,
        { userId: subscription.userId, email: subscription.applicantEmail },
        NotificationTemplate.SubscriptionPaymentRecorded,
        {
          name: subscription.applicantName,
          routeName: subscription.routeName,
          planName: subscription.planName,
          amountMinor: dto.amountMinor,
          paidInFull,
        },
      );
      return this.detail(id, tx);
    });
  }

  /**
   * BL-32. Corrects a mistaken payment with a REVERSAL row; nothing is
   * edited or deleted. Payment status is recomputed from the net amount.
   */
  reversePayment(
    id: string,
    paymentId: string,
    reason: string,
    staff: AuthenticatedUser,
  ) {
    return this.db.transaction(async (tx) => {
      const subscription = await this.subscriptions.lockReviewItem(id, tx);
      if (!subscription) throw new NotFoundException();
      const payment = await this.subscriptions.findPayment(id, paymentId, tx);
      if (!payment || payment.kind !== "PAYMENT")
        throw new NotFoundException("Payment not found on this subscription");
      if (payment.reversed)
        throw new ConflictException("This payment was already reversed");
      if (payment.amountMinor > subscription.paidMinor)
        throw new ConflictException(
          "Refunds already exceed what would remain; record the correction manually",
        );
      await this.subscriptions.insertPayment(
        id,
        {
          kind: "REVERSAL",
          amountMinor: payment.amountMinor,
          method: payment.method,
          paidOn: await this.cairoToday(tx),
          reversesPaymentId: paymentId,
          reason,
        },
        staff.id,
        tx,
      );
      await this.recomputePaymentStatus(
        id,
        subscription.feeMinor,
        subscription.paidMinor - payment.amountMinor,
        tx,
      );
      await this.audit.record(tx, {
        actorId: staff.id,
        action: AuditAction.PaymentReversed,
        entityId: id,
        metadata: { paymentId, amountMinor: payment.amountMinor, reason },
      });
      return this.detail(id, tx);
    });
  }

  /**
   * BL-32. Money handed back for a request that was rejected or withdrawn.
   * Cannot exceed the net amount paid.
   */
  recordRefund(id: string, dto: RecordRefundDto, staff: AuthenticatedUser) {
    return this.db.transaction(async (tx) => {
      const subscription = await this.subscriptions.lockReviewItem(id, tx);
      if (!subscription) throw new NotFoundException();
      if (
        subscription.status !== SubscriptionStatus.Rejected &&
        subscription.status !== SubscriptionStatus.Withdrawn
      )
        throw new ConflictException(
          "Refunds apply to rejected or withdrawn requests; reverse a mistaken payment instead",
        );
      if (dto.amountMinor > subscription.paidMinor)
        throw new BadRequestException(
          `Refund exceeds the ${subscription.paidMinor} piasters paid`,
        );
      if (await this.subscriptions.isFutureDate(dto.paidOn, tx))
        throw new BadRequestException("paidOn cannot be in the future");
      await this.subscriptions.insertPayment(
        id,
        { kind: "REFUND", ...dto },
        staff.id,
        tx,
      );
      await this.recomputePaymentStatus(
        id,
        subscription.feeMinor,
        subscription.paidMinor - dto.amountMinor,
        tx,
      );
      await this.audit.record(tx, {
        actorId: staff.id,
        action: AuditAction.RefundRecorded,
        entityId: id,
        metadata: {
          amountMinor: dto.amountMinor,
          method: dto.method,
          reason: dto.reason,
        },
      });
      await this.notifications.send(
        tx,
        { userId: subscription.userId, email: subscription.applicantEmail },
        NotificationTemplate.SubscriptionRefundRecorded,
        {
          name: subscription.applicantName,
          routeName: subscription.routeName,
          planName: subscription.planName,
          amountMinor: dto.amountMinor,
        },
      );
      return this.detail(id, tx);
    });
  }

  /** Owners see their own; reviewers see what their scope allows. */
  async get(id: string, viewer: AuthenticatedUser) {
    const subscription = await this.subscriptions.findReviewItem(id);
    if (!subscription) throw new NotFoundException();
    const isOwner = subscription.userId === viewer.id;
    const isReviewer =
      hasPermissions(viewer.role, [Permission.SubscriptionsReadAll]) &&
      this.inScope(viewer, subscription);
    // 404, not 403: do not confirm that someone else's request exists.
    if (!isOwner && !isReviewer) throw new NotFoundException();
    return this.detail(id);
  }

  async listMine(userId: string, page: PaginationQueryDto) {
    const { items, total } = await this.subscriptions.listByUser(userId, page);
    return toPage(items, total, page);
  }

  /** Faculty coordinators only ever see their own faculty's applicants. */
  async listForReview(
    query: ListSubscriptionsQueryDto,
    viewer: AuthenticatedUser,
  ) {
    const { items, total } = await this.subscriptions.listForReview(
      query,
      this.facultyScope(viewer),
    );
    return toPage(items, total, query);
  }

  private staffTransition(
    name: "review" | "suspend" | "reinstate",
    id: string,
    to: SubscriptionStatus,
    reason: string,
    staff: AuthenticatedUser,
  ) {
    return this.db.transaction(async (tx) => {
      if (name === "suspend") {
        // Lock order user → subscription, as in requests and bookings, so a
        // booking in flight finishes first and is then cancelled below.
        const peek = await this.subscriptions.findReviewItem(id, tx);
        if (peek) await this.subscriptions.lockApplicant(peek.userId, tx);
      }
      const subscription = await this.subscriptions.lockReviewItem(id, tx);
      if (!subscription) throw new NotFoundException();
      if (!this.inScope(staff, subscription))
        throw new ForbiddenException("This request belongs to another faculty");
      if (subscription.userId === staff.id)
        throw new ForbiddenException(
          "You cannot decide on your own subscription",
        );
      this.assertTransition(name, subscription.status, to);

      await this.subscriptions.applyStaffTransition(
        id,
        to,
        reason,
        staff.id,
        tx,
      );
      const cancelledBookings =
        name === "suspend"
          ? await this.cancelUpcomingBookings(
              subscription,
              reason,
              staff.id,
              tx,
            )
          : 0;
      await this.audit.record(tx, {
        actorId: staff.id,
        action: STAFF_AUDIT[name],
        entityId: id,
        metadata: { from: subscription.status, to, reason, cancelledBookings },
      });
      await this.notifications.send(
        tx,
        { userId: subscription.userId, email: subscription.applicantEmail },
        NotificationTemplate.SubscriptionStatusChanged,
        {
          name: subscription.applicantName,
          routeName: subscription.routeName,
          planName: subscription.planName,
          status: name === "reinstate" ? "REINSTATED" : to,
          reason,
        },
      );
      return this.detail(id, tx);
    });
  }

  private ownerTransition(
    name: TransitionName,
    id: string,
    to: SubscriptionStatus,
    note: string | null,
    userId: string,
    action: AuditAction,
  ) {
    return this.db.transaction(async (tx) => {
      const subscription = await this.subscriptions.lockReviewItem(id, tx);
      if (!subscription || subscription.userId !== userId)
        throw new NotFoundException();
      this.assertTransition(name, subscription.status, to);
      await this.subscriptions.applyOwnerTransition(id, to, note, tx);
      await this.audit.record(tx, {
        actorId: userId,
        action,
        entityId: id,
        metadata: { from: subscription.status, to },
      });
      return this.detail(id, tx);
    });
  }

  /** Suspension also cancels the passenger's upcoming bookings it covered. */
  private async cancelUpcomingBookings(
    subscription: SubscriptionReviewItemResponse,
    reason: string,
    actorId: string,
    tx: Queryable,
  ) {
    const affected = await this.bookings.upcomingConfirmedOnRoute(
      subscription.userId,
      subscription.routeId,
      subscription.coversFrom,
      subscription.coversUntil,
      tx,
    );
    const why = `إيقاف الاشتراك: ${reason}`;
    await this.bookings.cancelByAdmin(
      affected.map((b) => b.bookingId),
      why,
      actorId,
      tx,
    );
    await this.bookingNotifier.cancelledByAdmin(affected, why, tx);
    return affected.length;
  }

  private async recomputePaymentStatus(
    id: string,
    feeMinor: number,
    netPaid: number,
    tx: Queryable,
  ) {
    await this.subscriptions.setPaymentStatus(
      id,
      feeMinor === 0
        ? PaymentStatus.NotRequired
        : netPaid >= feeMinor
          ? PaymentStatus.Paid
          : PaymentStatus.Unpaid,
      tx,
    );
  }

  private async cairoToday(tx: Queryable) {
    const { rows } = await tx.query<{ today: string }>(
      "SELECT ((clock_timestamp() AT TIME ZONE 'Africa/Cairo')::date)::text AS today",
    );
    return rows[0]!.today;
  }

  private assertTransition(
    name: TransitionName,
    from: SubscriptionStatus,
    to: SubscriptionStatus,
  ) {
    if (!canTransition(name, from, to))
      throw new ConflictException(
        `Cannot ${name} a subscription that is ${from}`,
      );
  }

  private async detail(
    id: string,
    tx: Queryable = this.db,
  ): Promise<SubscriptionDetailResponse> {
    const [item, payments] = await Promise.all([
      this.subscriptions.findReviewItem(id, tx),
      this.subscriptions.listPayments(id, tx),
    ]);
    return { ...item!, payments };
  }

  private inScope(user: AuthenticatedUser, s: SubscriptionReviewItemResponse) {
    const scope = this.facultyScope(user);
    return !scope || s.applicantFacultyId === scope;
  }

  private facultyScope(user: AuthenticatedUser) {
    return user.role === UserRole.FacultyCoordinator ? user.facultyId : null;
  }
}
