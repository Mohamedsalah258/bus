import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ApiPageResponse } from "../../common/dto/page.dto.js";
import { ListAuditQueryDto } from "./dto/list-audit-query.dto.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import { AuditService } from "./audit.service.js";
import { AuditEventResponse } from "./dto/audit-event.response.js";

@ApiBearerAuth()
@ApiTags("Audit")
@Controller("audit-events")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @RequirePermissions(Permission.AuditRead)
  @Get()
  @ApiPageResponse(AuditEventResponse)
  list(@Query() query: ListAuditQueryDto) {
    return this.audit.list(query);
  }
}
