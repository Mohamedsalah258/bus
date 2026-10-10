import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from "@nestjs/swagger";
import { ApiPageResponse } from "../../common/dto/page.dto.js";
import { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import {
  ListNotificationsQueryDto,
  NotificationResponse,
} from "./dto/notification.dto.js";
import { NotificationsAdminService } from "./notifications-admin.service.js";

/** BL-34: see what did not arrive and send it again. */
@ApiBearerAuth()
@ApiTags("Notifications")
@RequirePermissions(Permission.NotificationsManage)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsAdminService) {}

  /** Default: failed deliveries, newest first. Content is never shown. */
  @Get()
  @ApiPageResponse(NotificationResponse)
  list(@Query() q: ListNotificationsQueryDto) {
    return this.notifications.list(q);
  }

  @Post(":id/retry")
  @HttpCode(204)
  @ApiNoContentResponse()
  async retry(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    await this.notifications.retry(id, u.id);
  }
}
