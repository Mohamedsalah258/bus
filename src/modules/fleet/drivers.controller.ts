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
import { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { ApiPageResponse } from "../../common/dto/page.dto.js";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import { CreateDriverDto } from "./dto/create-driver.dto.js";
import { DriverResponse } from "./dto/driver.response.js";
import { UpdateDriverDto } from "./dto/update-fleet.dto.js";
import { FleetService } from "./fleet.service.js";

@ApiBearerAuth()
@ApiTags("Fleet")
@Controller("drivers")
export class DriversController {
  constructor(private readonly fleet: FleetService) {}

  @RequirePermissions(Permission.FleetRead)
  @Get()
  @ApiPageResponse(DriverResponse)
  list(@Query() page: PaginationQueryDto) {
    return this.fleet.listDrivers(page);
  }

  @RequirePermissions(Permission.FleetManage)
  @Post()
  @ApiCreatedResponse({ type: DriverResponse })
  create(@Body() dto: CreateDriverDto) {
    return this.fleet.createDriver(dto);
  }

  @RequirePermissions(Permission.FleetManage)
  @Patch(":id")
  @ApiOkResponse({ type: DriverResponse })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fleet.updateDriver(id, dto, user.id);
  }
}
