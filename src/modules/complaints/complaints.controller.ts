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
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import { ComplaintsService } from "./complaints.service.js";
import {
  AssignComplaintDto,
  ComplaintDetailResponse,
  ComplaintMessageDto,
  ComplaintStaffItemResponse,
  CreateComplaintDto,
  ListComplaintsQueryDto,
  ResolveComplaintDto,
} from "./dto/complaint.dto.js";

@ApiBearerAuth()
@ApiTags("Complaints")
@Controller("complaints")
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  /** A complaint or suggestion; the reference is emailed to the author. */
  @RequirePermissions(Permission.ComplaintsSubmit)
  @Post()
  @ApiCreatedResponse({ type: ComplaintDetailResponse })
  create(@Body() dto: CreateComplaintDto, @CurrentUser() u: AuthenticatedUser) {
    return this.complaints.create(u, dto);
  }

  /** «متابعة الشكاوى»: the author's own complaints. */
  @Get("mine")
  @ApiPageResponse(ComplaintStaffItemResponse)
  mine(@Query() page: PaginationQueryDto, @CurrentUser() u: AuthenticatedUser) {
    return this.complaints.listMine(u.id, page);
  }

  /** Staff queue: open first, oldest first. */
  @RequirePermissions(Permission.ComplaintsRead)
  @Get()
  @ApiPageResponse(ComplaintStaffItemResponse)
  list(@Query() q: ListComplaintsQueryDto) {
    return this.complaints.listForStaff(q);
  }

  /** The author or complaint staff only; anyone else gets 404. */
  @Get(":id")
  @ApiOkResponse({ type: ComplaintDetailResponse })
  get(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.complaints.get(id, u);
  }

  @Post(":id/messages")
  @HttpCode(201)
  @ApiCreatedResponse({ type: ComplaintDetailResponse })
  reply(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ComplaintMessageDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.complaints.addMessage(id, u, dto);
  }

  @RequirePermissions(Permission.ComplaintsHandle)
  @Patch(":id/assign")
  @ApiOkResponse({ type: ComplaintDetailResponse })
  assign(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AssignComplaintDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.complaints.assign(id, dto.assigneeId, u);
  }

  @RequirePermissions(Permission.ComplaintsHandle)
  @Patch(":id/resolve")
  @ApiOkResponse({ type: ComplaintDetailResponse })
  resolve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResolveComplaintDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.complaints.resolve(id, dto.message, u);
  }

  /** The author or staff close it. */
  @Patch(":id/close")
  @ApiOkResponse({ type: ComplaintDetailResponse })
  close(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.complaints.close(id, u);
  }
}
