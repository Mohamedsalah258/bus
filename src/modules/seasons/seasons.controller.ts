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
import { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ApiPageResponse } from "../../common/dto/page.dto.js";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import { CreateSeasonDto, UpdateSeasonDto } from "./dto/create-season.dto.js";
import { SeasonResponse } from "./dto/season.response.js";
import { SeasonsService } from "./seasons.service.js";

@ApiBearerAuth()
@ApiTags("Seasons")
@Controller("seasons")
export class SeasonsController {
  constructor(private readonly seasons: SeasonsService) {}

  @Get()
  @ApiPageResponse(SeasonResponse)
  list(@Query() page: PaginationQueryDto) {
    return this.seasons.list(page);
  }

  @RequirePermissions(Permission.SeasonsManage)
  @Post()
  @ApiCreatedResponse({ type: SeasonResponse })
  create(@Body() dto: CreateSeasonDto) {
    return this.seasons.create(dto);
  }

  @RequirePermissions(Permission.SeasonsManage)
  @Patch(":id")
  @ApiOkResponse({ type: SeasonResponse })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateSeasonDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.seasons.update(id, dto, u.id);
  }
}
