import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto.js";
import { IsCalendarDate } from "../../../common/validation/is-calendar-date.decorator.js";
import { PLAN_PERIODS, PlanPeriod } from "../plan.constants.js";

export class CreatePlanDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() seasonId!: string;

  @ApiProperty({ example: "الفصل الدراسي الأول" })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ enum: PLAN_PERIODS }) @IsIn(PLAN_PERIODS) period!: PlanPeriod;

  @ApiProperty({ example: "2026-10-01", description: "Inside the season." })
  @IsCalendarDate()
  startsOn!: string;

  @ApiProperty({ example: "2027-01-31", description: "Inside the season." })
  @IsCalendarDate()
  endsOn!: string;

  @ApiProperty({
    description: "Fee in piasters (EGP × 100). 0 means free.",
    example: 150000,
  })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  feeMinor!: number;
}

export class PlanStatusDto {
  @ApiProperty() @IsBoolean() active!: boolean;

  @ApiProperty({ description: "Recorded in the audit log." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class ListPlansQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  seasonId?: string;
}

export class PlanResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) seasonId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: PLAN_PERIODS }) period!: PlanPeriod;
  @ApiProperty({ format: "date" }) startsOn!: string;
  @ApiProperty({ format: "date" }) endsOn!: string;
  @ApiProperty({ description: "Piasters; 0 = free." }) feeMinor!: number;
  @ApiProperty({ example: "EGP" }) currency!: string;
  @ApiProperty() active!: boolean;
}
