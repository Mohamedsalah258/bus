import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ApiPageResponse } from "../../common/dto/page.dto.js";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import { ApplySubscriptionDto } from "./dto/apply-subscription.dto.js";
import { CreateSubscriptionDto } from "./dto/create-subscription.dto.js";
import { ListSubscriptionsQueryDto } from "./dto/list-subscriptions-query.dto.js";
import {
  ReasonDto,
  RecordPaymentDto,
  RecordRefundDto,
  ResubmitSubscriptionDto,
  ReviewSubscriptionDto,
} from "./dto/review-subscription.dto.js";
import {
  SubscriptionDetailResponse,
  SubscriptionResponse,
  SubscriptionReviewItemResponse,
} from "./dto/subscription.response.js";
import { SubscriptionsService } from "./subscriptions.service.js";

@ApiBearerAuth()
@ApiTags("Subscriptions")
@Controller("subscriptions")
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @RequirePermissions(Permission.SubscriptionsRequest)
  @Post()
  @ApiCreatedResponse({ type: SubscriptionReviewItemResponse })
  request(
    @Body() dto: CreateSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.request(dto, user);
  }

  /**
   * One form, like the old site: name, phone, job title, faculty, category,
   * plan and route. Saves the profile and submits the request together.
   */
  @RequirePermissions(Permission.SubscriptionsRequest)
  @Post("apply")
  @ApiCreatedResponse({ type: SubscriptionReviewItemResponse })
  apply(
    @Body() dto: ApplySubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.apply(dto, user);
  }

  @Get("mine")
  @ApiPageResponse(SubscriptionResponse)
  listMine(
    @Query() page: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.listMine(user.id, page);
  }

  /** Review queue. Faculty coordinators see only their own faculty. */
  @RequirePermissions(Permission.SubscriptionsReadAll)
  @Get()
  @ApiPageResponse(SubscriptionReviewItemResponse)
  listForReview(
    @Query() query: ListSubscriptionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.listForReview(query, user);
  }

  /** With payments. The owner, or a reviewer within scope. */
  @Get(":id")
  @ApiOkResponse({ type: SubscriptionDetailResponse })
  get(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.get(id, user);
  }

  /** APPROVED, REJECTED or NEEDS_INFO, from PENDING. The applicant is emailed. */
  @RequirePermissions(Permission.SubscriptionsReview)
  @Patch(":id/review")
  @ApiOkResponse({ type: SubscriptionDetailResponse })
  review(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReviewSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.review(id, dto, user);
  }

  @RequirePermissions(Permission.SubscriptionsReview)
  @Patch(":id/suspend")
  @ApiOkResponse({ type: SubscriptionDetailResponse })
  suspend(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.suspend(id, dto.reason, user);
  }

  @RequirePermissions(Permission.SubscriptionsReview)
  @Patch(":id/reinstate")
  @ApiOkResponse({ type: SubscriptionDetailResponse })
  reinstate(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.reinstate(id, dto.reason, user);
  }

  /** The applicant answers a NEEDS_INFO request. */
  @RequirePermissions(Permission.SubscriptionsRequest)
  @Patch(":id/resubmit")
  @ApiOkResponse({ type: SubscriptionDetailResponse })
  resubmit(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResubmitSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.resubmit(id, dto.note, user.id);
  }

  @RequirePermissions(Permission.SubscriptionsRequest)
  @Patch(":id/withdraw")
  @ApiOkResponse({ type: SubscriptionDetailResponse })
  withdraw(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.withdraw(id, user.id);
  }

  /** Manual payment (cash, transfer, salary deduction). Full payment opens booking. */
  @RequirePermissions(Permission.SubscriptionsRecordPayment)
  @Post(":id/payments")
  @HttpCode(201)
  @ApiCreatedResponse({ type: SubscriptionDetailResponse })
  recordPayment(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.recordPayment(id, dto, user);
  }

  /** Corrects a mistaken payment: a REVERSAL row, never an edit or delete. */
  @RequirePermissions(Permission.SubscriptionsRecordPayment)
  @Post(":id/payments/:paymentId/reverse")
  @HttpCode(200)
  @ApiOkResponse({ type: SubscriptionDetailResponse })
  reversePayment(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("paymentId", ParseUUIDPipe) paymentId: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.reversePayment(id, paymentId, dto.reason, user);
  }

  /** Money handed back for a rejected or withdrawn request. */
  @RequirePermissions(Permission.SubscriptionsRecordPayment)
  @Post(":id/refunds")
  @HttpCode(201)
  @ApiCreatedResponse({ type: SubscriptionDetailResponse })
  recordRefund(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RecordRefundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.recordRefund(id, dto, user);
  }
}
