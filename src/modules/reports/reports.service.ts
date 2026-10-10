import { BadRequestException, Injectable } from "@nestjs/common";
import { toCsv } from "../../common/http/csv.js";
import { Database } from "../../database/database.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { AuditService } from "../audit/audit.service.js";
import { ReportsRepository } from "./reports.repository.js";

const MAX_DAYS = 366;

export type ReportName =
  | "bookings-daily"
  | "occupancy-route"
  | "occupancy-faculty"
  | "subscriptions"
  | "complaints";

export interface ReportOutput {
  json: unknown;
  csv: () => string;
}

/**
 * BL-20. Definitions (study §10): a trip counts when it offered seats —
 * published, closed, running or completed, never drafts or cancelled ones;
 * occupancy = confirmed bookings ÷ seats. Days are Cairo calendar days.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: Database,
    private readonly reports: ReportsRepository,
    private readonly audit: AuditService,
  ) {}

  async build(
    name: ReportName,
    from: string,
    to: string,
  ): Promise<ReportOutput> {
    if (to < from)
      throw new BadRequestException("`to` must not precede `from`");
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS)
      throw new BadRequestException(`A report covers at most ${MAX_DAYS} days`);
    switch (name) {
      case "bookings-daily": {
        const rows = await this.reports.dailyBookings(from, to);
        return {
          json: rows,
          csv: () =>
            toCsv(
              [
                "التاريخ",
                "الرحلات",
                "المقاعد",
                "حجوزات مؤكدة",
                "ألغاها الراكب",
                "ألغتها الإدارة",
              ],
              rows.map((r) => [
                r.date,
                r.trips,
                r.seats,
                r.confirmed,
                r.cancelledByPassenger,
                r.cancelledByAdmin,
              ]),
            ),
        };
      }
      case "occupancy-route": {
        const rows = await this.reports.occupancyByRoute(from, to);
        return {
          json: rows,
          csv: () =>
            toCsv(
              ["الخط", "الرحلات", "المقاعد", "حجوزات مؤكدة", "نسبة الإشغال %"],
              rows.map((r) => [
                r.routeName,
                r.trips,
                r.seats,
                r.confirmed,
                r.occupancyPercent,
              ]),
            ),
        };
      }
      case "occupancy-faculty": {
        const rows = await this.reports.bookingsByFaculty(from, to);
        return {
          json: rows,
          csv: () =>
            toCsv(
              ["الكلية", "حجوزات مؤكدة", "عدد الركاب"],
              rows.map((r) => [r.facultyName, r.confirmed, r.passengers]),
            ),
        };
      }
      case "subscriptions": {
        const report = await this.reports.subscriptions(from, to);
        return {
          json: report,
          csv: () =>
            toCsv(
              ["البند", "القيمة", "العدد"],
              [
                ...report.byStatus.map((r) => ["الحالة", r.key, r.count]),
                ...report.rejectionReasons.map((r) => [
                  "سبب الرفض",
                  r.key,
                  r.count,
                ]),
                ["متوسط ساعات القرار", report.averageDecisionHours ?? "", ""],
                ["معلق الآن", "", report.pendingNow],
              ],
            ),
        };
      }
      case "complaints": {
        const report = await this.reports.complaints(from, to);
        return {
          json: report,
          csv: () =>
            toCsv(
              ["البند", "القيمة", "العدد"],
              [
                ...report.byStatus.map((r) => ["الحالة", r.key, r.count]),
                ...report.byKind.map((r) => ["النوع", r.key, r.count]),
                ["متوسط ساعات الحل", report.averageResolutionHours ?? "", ""],
              ],
            ),
        };
      }
    }
  }

  /** FR-18: every export is recorded. */
  recordExport(name: ReportName, from: string, to: string, actorId: string) {
    return this.db.transaction((tx) =>
      this.audit.record(tx, {
        actorId,
        action: AuditAction.ReportExported,
        entityId: actorId,
        metadata: { report: name, from, to },
      }),
    );
  }
}
