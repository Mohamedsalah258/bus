import { Controller, Get, Query, Res } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { Permission } from "../auth/permissions.js";
import {
  ComplaintsReport,
  DailyBookingsRow,
  OccupancyQueryDto,
  ReportRangeDto,
  RouteOccupancyRow,
  SubscriptionsReport,
} from "./dto/report.dto.js";
import { ReportName, ReportsService } from "./reports.service.js";

/** Add `format=csv` to download for Excel; downloads are audited. */
@ApiBearerAuth()
@ApiTags("Reports")
@ApiProduces("application/json", "text/csv")
@RequirePermissions(Permission.ReportsRead)
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("bookings-daily")
  @ApiOkResponse({ type: [DailyBookingsRow] })
  daily(
    @Query() q: ReportRangeDto,
    @CurrentUser() u: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond("bookings-daily", q, u, res);
  }

  @Get("occupancy")
  @ApiOkResponse({
    description:
      "Rows of RouteOccupancyRow (groupBy=route) or FacultyBookingsRow (groupBy=faculty).",
    type: [RouteOccupancyRow],
  })
  occupancy(
    @Query() q: OccupancyQueryDto,
    @CurrentUser() u: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      q.groupBy === "faculty" ? "occupancy-faculty" : "occupancy-route",
      q,
      u,
      res,
    );
  }

  @Get("subscriptions")
  @ApiOkResponse({ type: SubscriptionsReport })
  subscriptions(
    @Query() q: ReportRangeDto,
    @CurrentUser() u: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond("subscriptions", q, u, res);
  }

  @Get("complaints")
  @ApiOkResponse({ type: ComplaintsReport })
  complaints(
    @Query() q: ReportRangeDto,
    @CurrentUser() u: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond("complaints", q, u, res);
  }

  private async respond(
    name: ReportName,
    q: ReportRangeDto,
    u: AuthenticatedUser,
    res: Response,
  ) {
    const report = await this.reports.build(name, q.from, q.to);
    if (q.format !== "csv") return report.json;
    await this.reports.recordExport(name, q.from, q.to, u.id);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${name}_${q.from}_${q.to}.csv"`,
    );
    return report.csv();
  }
}
