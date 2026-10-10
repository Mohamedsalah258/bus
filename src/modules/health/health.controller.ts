import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/decorators/public.decorator.js";
import { HealthService } from "./health.service.js";

@ApiTags("Health")
@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Process is up. */
  @Get("live")
  @ApiOkResponse({ schema: { example: { status: "ok" } } })
  live() {
    return { status: "ok" };
  }

  /** Database reachable and migrated. */
  @Get("ready")
  @ApiOkResponse({ schema: { example: { status: "ready" } } })
  async ready() {
    if (!(await this.health.isDatabaseReady()))
      throw new ServiceUnavailableException("Database not ready");
    return { status: "ready" };
  }
}
