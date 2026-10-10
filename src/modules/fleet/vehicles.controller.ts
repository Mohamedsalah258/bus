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
import { CreateVehicleDto } from "./dto/create-vehicle.dto.js";
import { VehicleResponse } from "./dto/vehicle.response.js";
import { UpdateVehicleDto } from "./dto/update-fleet.dto.js";
import { FleetService } from "./fleet.service.js";

@ApiBearerAuth()
@ApiTags("Fleet")
@Controller("vehicles")
export class VehiclesController {
  constructor(private readonly fleet: FleetService) {}

  @RequirePermissions(Permission.FleetRead)
  @Get()
  @ApiPageResponse(VehicleResponse)
  list(@Query() page: PaginationQueryDto) {
    return this.fleet.listVehicles(page);
  }

  @RequirePermissions(Permission.FleetManage)
  @Post()
  @ApiCreatedResponse({ type: VehicleResponse })
  create(@Body() dto: CreateVehicleDto) {
    return this.fleet.createVehicle(dto);
  }

  @RequirePermissions(Permission.FleetManage)
  @Patch(":id")
  @ApiOkResponse({ type: VehicleResponse })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fleet.updateVehicle(id, dto, user.id);
  }
}
