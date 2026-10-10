import {
  Body,
  Controller,
  Delete,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import {
  CreateScheduleDto,
  ExceptionsQueryDto,
  GenerateTripsDto,
  GenerationReport,
  ScheduleResponse,
  ServiceExceptionDto,
  ServiceExceptionResponse,
  UpdateScheduleDto,
} from "./dto/schedule.dto.js";
import { SchedulesService } from "./schedules.service.js";

@ApiBearerAuth()
@ApiTags("Schedules")
@RequirePermissions(Permission.TripsManage)
@Controller()
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get("schedules")
  @ApiQuery({ name: "routeId", required: false })
  @ApiOkResponse({ type: [ScheduleResponse] })
  list(
    @Query("routeId", new ParseUUIDPipe({ optional: true })) routeId?: string,
  ) {
    return this.schedules.list(routeId ?? null);
  }

  /** Time, days (Saturday-first week), seats, cutoffs, bus and driver: all set here. */
  @Post("schedules")
  @ApiCreatedResponse({ type: ScheduleResponse })
  create(@Body() dto: CreateScheduleDto, @CurrentUser() u: AuthenticatedUser) {
    return this.schedules.create(dto, u.id);
  }

  @Patch("schedules/:id")
  @ApiOkResponse({ type: ScheduleResponse })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.schedules.update(id, dto, u.id);
  }

  /** Creates the real trips for a period. Use dryRun first to preview. */
  @Post("schedules/:id/generate")
  @HttpCode(200)
  @ApiOkResponse({ type: GenerationReport })
  generate(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateTripsDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.schedules.generate(id, dto, u.id);
  }

  /** Days without service. Existing trips that day are reported, not cancelled. */
  @Post("service-exceptions")
  @HttpCode(201)
  @ApiCreatedResponse({ type: ServiceExceptionResponse })
  addException(
    @Body() dto: ServiceExceptionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.schedules.addException(dto, u.id);
  }

  @Get("service-exceptions")
  @ApiOkResponse({ type: [ServiceExceptionResponse] })
  listExceptions(@Query() q: ExceptionsQueryDto) {
    return this.schedules.listExceptions(q.from, q.to);
  }

  @Delete("service-exceptions/:id")
  @HttpCode(204)
  @ApiNoContentResponse()
  async removeException(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    await this.schedules.removeException(id, u.id);
  }
}
