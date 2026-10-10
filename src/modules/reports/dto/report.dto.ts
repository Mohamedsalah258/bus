import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { IsCalendarDate } from "../../../common/validation/is-calendar-date.decorator.js";

export class ReportRangeDto {
  @ApiProperty({
    example: "2026-10-01",
    description: "Cairo calendar date, inclusive.",
  })
  @IsCalendarDate()
  from!: string;

  @ApiProperty({
    example: "2026-10-31",
    description: "Inclusive; at most 366 days.",
  })
  @IsCalendarDate()
  to!: string;

  @ApiPropertyOptional({
    enum: ["json", "csv"],
    default: "json",
    description: "csv downloads for Excel; every export is audited.",
  })
  @IsOptional()
  @IsIn(["json", "csv"])
  format?: "json" | "csv";
}

export class OccupancyQueryDto extends ReportRangeDto {
  @ApiPropertyOptional({ enum: ["route", "faculty"], default: "route" })
  @IsOptional()
  @IsIn(["route", "faculty"])
  groupBy?: "route" | "faculty";
}

export class DailyBookingsRow {
  @ApiProperty({ format: "date", description: "Travel date (Cairo)." })
  date!: string;
  @ApiProperty() trips!: number;
  @ApiProperty() seats!: number;
  @ApiProperty() confirmed!: number;
  @ApiProperty() cancelledByPassenger!: number;
  @ApiProperty() cancelledByAdmin!: number;
}

export class RouteOccupancyRow {
  @ApiProperty({ format: "uuid" }) routeId!: string;
  @ApiProperty() routeName!: string;
  @ApiProperty({
    description: "Published, closed, running or completed trips.",
  })
  trips!: number;
  @ApiProperty() seats!: number;
  @ApiProperty() confirmed!: number;
  @ApiProperty({ description: "confirmed ÷ seats × 100, one decimal." })
  occupancyPercent!: number;
}

export class FacultyBookingsRow {
  @ApiProperty({ format: "uuid", nullable: true, type: String }) facultyId!:
    string | null;
  @ApiProperty() facultyName!: string;
  @ApiProperty() confirmed!: number;
  @ApiProperty({ description: "Distinct passengers." }) passengers!: number;
}

export class CountRow {
  @ApiProperty() key!: string;
  @ApiProperty() count!: number;
}

export class SubscriptionsReport {
  @ApiProperty({
    type: [CountRow],
    description: "Requests created in range, by status.",
  })
  byStatus!: CountRow[];
  @ApiProperty({
    type: [CountRow],
    description: "Most frequent rejection reasons.",
  })
  rejectionReasons!: CountRow[];
  @ApiProperty({
    nullable: true,
    type: Number,
    description: "Average hours from request to decision.",
  })
  averageDecisionHours!: number | null;
  @ApiProperty({ description: "Pending now, all dates." }) pendingNow!: number;
}

export class ComplaintsReport {
  @ApiProperty({ type: [CountRow] }) byStatus!: CountRow[];
  @ApiProperty({ type: [CountRow] }) byKind!: CountRow[];
  @ApiProperty({
    nullable: true,
    type: Number,
    description: "Average hours from filing to resolution.",
  })
  averageResolutionHours!: number | null;
}
