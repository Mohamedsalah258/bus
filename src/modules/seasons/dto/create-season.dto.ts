import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";
import { IsCalendarDate } from "../../../common/validation/is-calendar-date.decorator.js";

export class CreateSeasonDto {
  @ApiProperty() @IsString() @Length(2, 150) name!: string;

  @ApiProperty({ example: "2026-10-01" }) @IsCalendarDate() startsOn!: string;

  @ApiProperty({ example: "2027-09-30" }) @IsCalendarDate() endsOn!: string;
}

/** Dates may only change while every plan of the season still fits inside. */
export class UpdateSeasonDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 150)
  name?: string;
  @ApiPropertyOptional() @IsOptional() @IsCalendarDate() startsOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsCalendarDate() endsOn?: string;
  @ApiProperty({ description: "Recorded in the audit log." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}
