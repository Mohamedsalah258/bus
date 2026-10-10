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
import { Public } from "../auth/decorators/public.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import { CategoriesService } from "./categories.service.js";
import {
  CategoryResponse,
  CreateCategoryDto,
  UpdateCategoryDto,
} from "./dto/category.dto.js";

@ApiTags("Beneficiary categories")
@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** Public so the registration form can offer the active categories. */
  @Public()
  @Get()
  @ApiPageResponse(CategoryResponse)
  list(@Query() page: PaginationQueryDto) {
    return this.categories.listActive(page);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.CategoriesManage)
  @Post()
  @ApiCreatedResponse({ type: CategoryResponse })
  create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.categories.create(dto, user.id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.CategoriesManage)
  @Patch(":id")
  @ApiOkResponse({ type: CategoryResponse })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.categories.update(id, dto, u.id);
  }
}
