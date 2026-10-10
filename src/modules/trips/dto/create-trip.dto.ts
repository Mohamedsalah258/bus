import { ApiProperty } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from "class-validator";
import { IsZonedTimestamp } from "../../../common/validation/is-zoned-timestamp.decorator.js";
import { TRIP_DIRECTIONS, TripDirection } from "../trip.constants.js";

export class CreateTripDto {
  @ApiProperty() @IsUUID() routeId!: string;

  @ApiProperty() @IsUUID() vehicleId!: string;

  @ApiProperty() @IsUUID() driverId!: string;

  @ApiProperty({ enum: TRIP_DIRECTIONS })
  @IsIn(TRIP_DIRECTIONS)
  direction!: TripDirection;

  @ApiProperty({ example: "2026-11-01T07:00:00+02:00" })
  @IsZonedTimestamp()
  departureAt!: string;

  @ApiProperty({ example: "2026-11-01T09:00:00+02:00" })
  @IsZonedTimestamp()
  arrivalAt!: string;

  @ApiProperty() @IsZonedTimestamp() bookingClosesAt!: string;

  @ApiProperty() @IsZonedTimestamp() cancellationClosesAt!: string;

  @ApiProperty() @IsInt() @Min(1) @Max(100) capacity!: number;

  @ApiProperty({
    required: false,
    default: true,
    description: "false creates a DRAFT, hidden from members until published.",
  })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}
