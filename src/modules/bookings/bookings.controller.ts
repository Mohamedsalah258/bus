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
import { BookingsService } from "./bookings.service.js";
import { BookingResponse, MyBookingResponse } from "./dto/booking.response.js";
import { CreateBookingDto } from "./dto/create-booking.dto.js";
import { CreateRoundTripDto, RoundTripResponse } from "./dto/round-trip.dto.js";
import { TripReasonDto } from "../trips/dto/trip-actions.dto.js";

@ApiBearerAuth()
@ApiTags("Bookings")
@Controller("bookings")
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @RequirePermissions(Permission.BookingsCreate)
  @Post()
  @ApiCreatedResponse({
    type: BookingResponse,
    description:
      "A retry with the same idempotencyKey returns the original booking, even if cancelled since.",
  })
  create(
    @Body() dto: CreateBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.create(dto, user.id);
  }

  /** Outbound and return together: both confirmed, or neither. */
  @RequirePermissions(Permission.BookingsCreate)
  @Post("round-trip")
  @ApiCreatedResponse({ type: RoundTripResponse })
  roundTrip(
    @Body() dto: CreateRoundTripDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.createRoundTrip(dto, user.id);
  }

  @Get("mine")
  @ApiPageResponse(MyBookingResponse)
  listMine(
    @Query() page: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.listMine(user.id, page);
  }

  /** Add `?withPair=true` to cancel both legs of a round trip. */
  @Patch(":id/cancel")
  @ApiOkResponse({ type: BookingResponse })
  cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("withPair") withPair: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.cancel(id, user.id, withPair === "true");
  }

  /** Staff cancel a booking with a reason; the passenger is emailed. */
  @RequirePermissions(Permission.BookingsManage)
  @Patch(":id/admin-cancel")
  @ApiOkResponse({ type: BookingResponse })
  adminCancel(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TripReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.adminCancel(id, dto.reason, user.id);
  }
}
