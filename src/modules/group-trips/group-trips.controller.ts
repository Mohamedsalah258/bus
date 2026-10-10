import {
  Body,
  Controller,
  Get,
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
import {
  ApproveGroupTripDto,
  CreateGroupTripDto,
  GroupTripDetailResponse,
  GroupTripNoteDto,
  GroupTripReasonDto,
  GroupTripResponse,
  ListGroupTripsQueryDto,
} from "./dto/group-trip.dto.js";
import { GroupTripsService } from "./group-trips.service.js";

@ApiBearerAuth()
@ApiTags("Group trips")
@Controller("group-trips")
export class GroupTripsController {
  constructor(private readonly groupTrips: GroupTripsService) {}

  /** The old student-activities form. The transport office decides. */
  @RequirePermissions(Permission.GroupTripsRequest)
  @Post()
  @ApiCreatedResponse({ type: GroupTripDetailResponse })
  create(@Body() dto: CreateGroupTripDto, @CurrentUser() u: AuthenticatedUser) {
    return this.groupTrips.create(u, dto);
  }

  @Get("mine")
  @ApiPageResponse(GroupTripResponse)
  mine(@Query() page: PaginationQueryDto, @CurrentUser() u: AuthenticatedUser) {
    return this.groupTrips.listMine(u.id, page);
  }

  /** Transport office queue: pending first, soonest departure first. */
  @RequirePermissions(Permission.GroupTripsRead)
  @Get()
  @ApiPageResponse(GroupTripResponse)
  list(@Query() q: ListGroupTripsQueryDto) {
    return this.groupTrips.listForOffice(q);
  }

  @Get(":id")
  @ApiOkResponse({ type: GroupTripDetailResponse })
  get(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.groupTrips.get(id, u);
  }

  /** Assign buses and drivers; creates the trips that hold them. */
  @RequirePermissions(Permission.GroupTripsManage)
  @Patch(":id/approve")
  @ApiOkResponse({ type: GroupTripDetailResponse })
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApproveGroupTripDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.groupTrips.approve(id, dto, u);
  }

  @RequirePermissions(Permission.GroupTripsManage)
  @Patch(":id/reject")
  @ApiOkResponse({ type: GroupTripDetailResponse })
  reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GroupTripReasonDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.groupTrips.reject(id, dto.reason, u);
  }

  /** Not a rejection: the requester completes and resubmits. */
  @RequirePermissions(Permission.GroupTripsManage)
  @Patch(":id/needs-info")
  @ApiOkResponse({ type: GroupTripDetailResponse })
  needsInfo(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GroupTripReasonDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.groupTrips.needsInfo(id, dto.reason, u);
  }

  /** Cancels an approved outing and frees its buses. */
  @RequirePermissions(Permission.GroupTripsManage)
  @Patch(":id/cancel")
  @ApiOkResponse({ type: GroupTripDetailResponse })
  cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GroupTripReasonDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.groupTrips.cancel(id, dto.reason, u);
  }

  @RequirePermissions(Permission.GroupTripsRequest)
  @Patch(":id/resubmit")
  @ApiOkResponse({ type: GroupTripDetailResponse })
  resubmit(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GroupTripNoteDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.groupTrips.resubmit(id, dto.note, u);
  }

  @RequirePermissions(Permission.GroupTripsRequest)
  @Patch(":id/withdraw")
  @ApiOkResponse({ type: GroupTripDetailResponse })
  withdraw(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.groupTrips.withdraw(id, u);
  }
}
