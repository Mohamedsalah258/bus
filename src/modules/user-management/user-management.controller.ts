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
import { UserAdminResponse } from "../users/dto/user.response.js";
import {
  AdminEditProfileDto,
  ChangeRoleDto,
  ChangeStatusDto,
  CreateUserDto,
  ListUsersQueryDto,
  ReasonDto,
  ResetPasswordDto,
} from "./dto/user-management.dto.js";
import { UserManagementService } from "./user-management.service.js";

@ApiBearerAuth()
@ApiTags("User management")
@Controller("users")
export class UserManagementController {
  constructor(private readonly users: UserManagementService) {}

  @RequirePermissions(Permission.UsersRead)
  @Get()
  @ApiPageResponse(UserAdminResponse)
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @RequirePermissions(Permission.UsersRead)
  @Get(":id")
  @ApiOkResponse({ type: UserAdminResponse })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  /** Staff or pre-approved accounts; the password must be changed at first login. */
  @RequirePermissions(Permission.UsersManage)
  @Post()
  @ApiCreatedResponse({ type: UserAdminResponse })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.create(dto, actor.id);
  }

  @RequirePermissions(Permission.UsersManage)
  @Patch(":id/role")
  @ApiOkResponse({ type: UserAdminResponse })
  changeRole(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.changeRole(id, dto, actor.id);
  }

  @RequirePermissions(Permission.UsersManage)
  @Patch(":id/status")
  @ApiOkResponse({ type: UserAdminResponse })
  changeStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.changeStatus(id, dto, actor.id);
  }

  @RequirePermissions(Permission.UsersManage)
  @Post(":id/mfa/reset")
  @HttpCode(200)
  @ApiOkResponse({ type: UserAdminResponse })
  resetMfa(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.resetMfa(id, dto.reason, actor.id);
  }

  @RequirePermissions(Permission.UsersManage)
  @Post(":id/password/reset")
  @HttpCode(200)
  @ApiOkResponse({ type: UserAdminResponse })
  resetPassword(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.resetPassword(id, dto, actor.id);
  }

  /** Name, phone, job title, faculty, category; audited with a reason. */
  @RequirePermissions(Permission.UsersManage)
  @Patch(":id/profile")
  @ApiOkResponse({ type: UserAdminResponse })
  editProfile(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AdminEditProfileDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.editProfile(id, dto, actor.id);
  }
}
