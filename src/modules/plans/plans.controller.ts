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
import { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import {
  CreatePlanDto,
  ListPlansQueryDto,
  PlanResponse,
  PlanStatusDto,
} from "./dto/plan.dto.js";
import { PlansService } from "./plans.service.js";

@ApiBearerAuth()
@ApiTags("Subscription plans")
@Controller("plans")
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  /** Plans open for requests (active and not ended). */
  @Get()
  @ApiPageResponse(PlanResponse)
  list(@Query() query: ListPlansQueryDto) {
    return this.plans.listOpen(query);
  }

  @RequirePermissions(Permission.PlansManage)
  @Post()
  @ApiCreatedResponse({ type: PlanResponse })
  create(@Body() dto: CreatePlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plans.create(dto, user.id);
  }

  @RequirePermissions(Permission.PlansManage)
  @Patch(":id/status")
  @ApiOkResponse({ type: PlanResponse })
  setStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: PlanStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plans.setStatus(id, dto, user.id);
  }
}
