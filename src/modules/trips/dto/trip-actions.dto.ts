import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto.js";
import { IsZonedTimestamp } from "../../../common/validation/is-zoned-timestamp.decorator.js";
import { TRIP_STATUSES, TripStatus } from "../trip.constants.js";

export class TripReasonDto {
  @ApiProperty({ description: "Emailed to passengers and audited." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class TripScheduleQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: "2026-10-11T00:00:00+03:00" })
  @IsZonedTimestamp()
  from!: string;

  @ApiProperty({ example: "2026-10-18T00:00:00+03:00" })
  @IsZonedTimestamp()
  to!: string;

  @ApiPropertyOptional({ enum: TRIP_STATUSES })
  @IsOptional()
  @IsIn(TRIP_STATUSES)
  status?: TripStatus;
}

export class TripCapacityDto extends TripReasonDto {
  @ApiProperty({ minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  capacity!: number;
}
