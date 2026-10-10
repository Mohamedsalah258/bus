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
import { Public } from "../auth/decorators/public.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import {
  CreateFacultyDto,
  UpdateFacultyDto,
} from "./dto/create-faculty.dto.js";
import { FacultyResponse } from "./dto/faculty.response.js";
import { FacultiesService } from "./faculties.service.js";

@ApiTags("Faculties")
@Controller("faculties")
export class FacultiesController {
  constructor(private readonly faculties: FacultiesService) {}

  /** Public so the registration form can list faculties. */
  @Public()
  @Get()
  @ApiPageResponse(FacultyResponse)
  list(@Query() page: PaginationQueryDto) {
    return this.faculties.list(page);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.FacultiesManage)
  @Post()
  @ApiCreatedResponse({ type: FacultyResponse })
  create(@Body() dto: CreateFacultyDto) {
    return this.faculties.create(dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.FacultiesManage)
  @Patch(":id")
  @ApiOkResponse({ type: FacultyResponse })
  rename(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateFacultyDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.faculties.rename(id, dto, u.id);
  }
}
