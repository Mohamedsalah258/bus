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
import { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import { CreateTripDto } from "./dto/create-trip.dto.js";
import { ListTripsQueryDto } from "./dto/list-trips-query.dto.js";
import {
  TripCapacityDto,
  TripReasonDto,
  TripScheduleQueryDto,
} from "./dto/trip-actions.dto.js";
import {
  TripCancellationResponse,
  TripListItemResponse,
  TripResponse,
  TripScheduleItemResponse,
} from "./dto/trip.response.js";
import { TripsService } from "./trips.service.js";

@ApiBearerAuth()
@ApiTags("Trips")
@Controller("trips")
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  /** Published future trips. Remaining seats are advisory until booking. */
  @Get()
  @ApiPageResponse(TripListItemResponse)
  listUpcoming(@Query() query: ListTripsQueryDto) {
    return this.trips.listUpcoming(query);
  }

  /** Staff schedule: every status in a time window, with seats taken. */
  @RequirePermissions(Permission.TripsManage)
  @Get("schedule")
  @ApiPageResponse(TripScheduleItemResponse)
  schedule(@Query() query: TripScheduleQueryDto) {
    return this.trips.listSchedule(query);
  }

  @RequirePermissions(Permission.TripsManage)
  @Get(":id")
  @ApiOkResponse({ type: TripResponse })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.trips.get(id);
  }

  @RequirePermissions(Permission.TripsManage)
  @Post()
  @ApiCreatedResponse({ type: TripResponse })
  create(@Body() dto: CreateTripDto, @CurrentUser() user: AuthenticatedUser) {
    return this.trips.create(dto, user.id);
  }

  @RequirePermissions(Permission.TripsManage)
  @Post(":id/publish")
  @HttpCode(200)
  @ApiOkResponse({ type: TripResponse })
  publish(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.trips.transition(id, "publish", u.id);
  }

  /** Stops new bookings early; passengers can still cancel until the cutoff. */
  @RequirePermissions(Permission.TripsManage)
  @Post(":id/close")
  @HttpCode(200)
  @ApiOkResponse({ type: TripResponse })
  close(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.trips.transition(id, "close", u.id);
  }

  @RequirePermissions(Permission.TripsManage)
  @Post(":id/reopen")
  @HttpCode(200)
  @ApiOkResponse({ type: TripResponse })
  reopen(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.trips.transition(id, "reopen", u.id);
  }

  @RequirePermissions(Permission.TripsManage)
  @Post(":id/start")
  @HttpCode(200)
  @ApiOkResponse({ type: TripResponse })
  start(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.trips.transition(id, "start", u.id);
  }

  @RequirePermissions(Permission.TripsManage)
  @Post(":id/complete")
  @HttpCode(200)
  @ApiOkResponse({ type: TripResponse })
  complete(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.trips.transition(id, "complete", u.id);
  }

  /** Cancels the trip and all its confirmed bookings; passengers are emailed. */
  @RequirePermissions(Permission.TripsManage)
  @Post(":id/cancel")
  @HttpCode(200)
  @ApiOkResponse({ type: TripCancellationResponse })
  cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TripReasonDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.trips.cancel(id, dto.reason, u.id);
  }

  /** Seats on this trip only: not below confirmed bookings, not above the bus. */
  @RequirePermissions(Permission.TripsManage)
  @Patch(":id/capacity")
  @ApiOkResponse({ type: TripResponse })
  setCapacity(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TripCapacityDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.trips.setCapacity(id, dto.capacity, dto.reason, u.id);
  }
}
