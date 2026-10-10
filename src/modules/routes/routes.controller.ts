import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import {
  CreateRouteDto,
  ReplaceStopsDto,
  RouteDefaultsDto,
  RouteEligibilityDto,
  UpdateRouteDto,
} from "./dto/create-route.dto.js";
import { ListRoutesQueryDto } from "./dto/list-routes-query.dto.js";
import { RouteResponse, RouteUpdateResponse } from "./dto/route.response.js";
import { hasPermissions } from "../auth/permissions.js";
import { RoutesService } from "./routes.service.js";

@ApiBearerAuth()
@ApiTags("Routes")
@Controller("routes")
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get()
  @ApiPageResponse(RouteResponse)
  list(
    @Query() query: ListRoutesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (
      query.includeInactive &&
      !hasPermissions(user.role, [Permission.RoutesManage])
    )
      throw new ForbiddenException("Closed routes are visible to staff only");
    return this.routes.list(query, query.includeInactive ?? false);
  }

  @RequirePermissions(Permission.RoutesManage)
  @Post()
  @ApiCreatedResponse({ type: RouteResponse })
  create(@Body() dto: CreateRouteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.routes.create(dto, user.id);
  }

  /** Replaces the categories allowed to request subscriptions on this route. */
  @RequirePermissions(Permission.RoutesManage)
  @Put(":id/eligible-categories")
  @ApiOkResponse({ type: RouteResponse })
  updateEligibility(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RouteEligibilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.routes.updateEligibility(id, dto, user.id);
  }

  /** Sets the bus and driver normally assigned to this route. */
  @RequirePermissions(Permission.RoutesManage)
  @Put(":id/defaults")
  @ApiOkResponse({ type: RouteResponse })
  updateDefaults(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RouteDefaultsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.routes.updateDefaults(id, dto, user.id);
  }

  /** Rename, close (active: false) or reopen a route. */
  @RequirePermissions(Permission.RoutesManage)
  @Patch(":id")
  @ApiOkResponse({ type: RouteUpdateResponse })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateRouteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.routes.update(id, dto, user.id);
  }

  /** Replace the stop list; past bookings keep their stops (retired, never deleted). */
  @RequirePermissions(Permission.RoutesManage)
  @Put(":id/stops")
  @ApiOkResponse({ type: RouteResponse })
  replaceStops(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReplaceStopsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.routes.replaceStops(id, dto, user.id);
  }
}
