import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";
import { IsCalendarDate } from "../../../common/validation/is-calendar-date.decorator.js";
import { TRIP_DIRECTIONS, TripDirection } from "../../trips/trip.constants.js";
import { WEEKDAYS, Weekday } from "../weekdays.js";

export class CreateScheduleDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() routeId!: string;

  @ApiProperty({ example: "الخط الغربي — ذهاب الصباح" })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ enum: TRIP_DIRECTIONS })
  @IsIn(TRIP_DIRECTIONS)
  direction!: TripDirection;

  @ApiProperty({ example: "06:30", description: "Cairo time, 24-hour HH:MM." })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: "departureTime must be HH:MM",
  })
  departureTime!: string;

  @ApiProperty({
    example: 120,
    description: "Minutes from departure to arrival.",
  })
  @IsInt()
  @Min(5)
  @Max(720)
  durationMinutes!: number;

  @ApiProperty({
    enum: WEEKDAYS,
    isArray: true,
    example: ["SAT", "SUN", "MON", "TUE", "WED", "THU"],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsIn(WEEKDAYS, { each: true })
  weekdays!: Weekday[];

  @ApiProperty({ example: "2026-10-01" }) @IsCalendarDate() validFrom!: string;

  @ApiProperty({ example: "2027-06-30" }) @IsCalendarDate() validUntil!: string;

  @ApiPropertyOptional({
    format: "uuid",
    description: "Default: the route's bus.",
  })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({
    format: "uuid",
    description: "Default: the route's driver.",
  })
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiPropertyOptional({
    description: "Seats per trip. Default: the bus's capacity.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  capacity?: number;

  @ApiProperty({
    example: 720,
    description: "Booking closes this many minutes before departure.",
  })
  @IsInt()
  @Min(0)
  @Max(10080)
  bookingCloseMinutes!: number;

  @ApiProperty({
    example: 720,
    description:
      "Passengers may cancel until this many minutes before departure.",
  })
  @IsInt()
  @Min(0)
  @Max(10080)
  cancellationCloseMinutes!: number;
}

/** Changes apply to trips generated from now on; existing trips keep theirs. */
export class UpdateScheduleDto extends PartialType(CreateScheduleDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class ScheduleResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) routeId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: TRIP_DIRECTIONS }) direction!: TripDirection;
  @ApiProperty({ example: "06:30" }) departureTime!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty({ enum: WEEKDAYS, isArray: true }) weekdays!: Weekday[];
  @ApiProperty({ format: "date" }) validFrom!: string;
  @ApiProperty({ format: "date" }) validUntil!: string;
  @ApiProperty({ format: "uuid", nullable: true, type: String }) vehicleId!:
    string | null;
  @ApiProperty({ format: "uuid", nullable: true, type: String }) driverId!:
    string | null;
  @ApiProperty({ nullable: true, type: Number }) capacity!: number | null;
  @ApiProperty() bookingCloseMinutes!: number;
  @ApiProperty() cancellationCloseMinutes!: number;
  @ApiProperty() active!: boolean;
}

export class GenerateTripsDto {
  @ApiProperty({ example: "2026-10-10" }) @IsCalendarDate() from!: string;
  @ApiProperty({ example: "2026-10-31" }) @IsCalendarDate() to!: string;

  @ApiPropertyOptional({ default: true, description: "false creates drafts." })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: "Report only; nothing is saved.",
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class GenerationConflict {
  @ApiProperty({ format: "date" }) date!: string;
  @ApiProperty() reason!: string;
}

export class GenerationReport {
  @ApiProperty() dryRun!: boolean;
  @ApiProperty({
    description: "Trips created (or that would be, in a dry run).",
  })
  created!: number;
  @ApiProperty({ type: [String], format: "date" }) createdDates!: string[];
  @ApiProperty({
    type: [String],
    format: "date",
    description: "Service exceptions.",
  })
  skippedHolidays!: string[];
  @ApiProperty({
    type: [String],
    format: "date",
    description: "Already generated (even if cancelled since).",
  })
  skippedExisting!: string[];
  @ApiProperty({
    type: [String],
    format: "date",
    description: "Booking cutoff already passed.",
  })
  skippedPast!: string[];
  @ApiProperty({
    type: [GenerationConflict],
    description: "Bus or driver busy at that time.",
  })
  conflicts!: GenerationConflict[];
}

export class ServiceExceptionDto {
  @ApiProperty({ example: "2026-10-06" }) @IsCalendarDate() date!: string;
  @ApiProperty({ example: "عيد القوات المسلحة" })
  @IsString()
  @Length(2, 200)
  reason!: string;
}

export class ServiceExceptionResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "date" }) date!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({
    description: "Trips already scheduled that day; cancel them if needed.",
  })
  tripsThatDay!: number;
}

export class ExceptionsQueryDto {
  @ApiProperty({ example: "2026-09-01" }) @IsCalendarDate() from!: string;
  @ApiProperty({ example: "2027-08-31" }) @IsCalendarDate() to!: string;
}
