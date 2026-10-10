import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from "class-validator";

export class RouteStopDto {
  @ApiProperty() @IsString() @Length(2, 150) name!: string;
}

/** Stops are stored in the given order as the outbound sequence. */
export class CreateRouteDto {
  @ApiProperty() @IsString() @Length(2, 150) name!: string;

  @ApiProperty({ type: [RouteStopDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RouteStopDto)
  stops!: RouteStopDto[];

  @ApiProperty({
    type: [String],
    format: "uuid",
    description: "Beneficiary categories allowed to subscribe to this route.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID("all", { each: true })
  eligibleCategoryIds!: string[];

  @ApiProperty({ required: false, format: "uuid" })
  @IsOptional()
  @IsUUID()
  defaultVehicleId?: string;

  @ApiProperty({ required: false, format: "uuid" })
  @IsOptional()
  @IsUUID()
  defaultDriverId?: string;
}

/** Set or clear (null) the route's usual bus and driver. */
export class RouteDefaultsDto {
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  @IsOptional()
  @IsUUID()
  defaultVehicleId!: string | null;

  @ApiProperty({ format: "uuid", nullable: true, type: String })
  @IsOptional()
  @IsUUID()
  defaultDriverId!: string | null;

  @ApiProperty({ description: "Recorded in the audit log." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class RouteEligibilityDto {
  @ApiProperty({ type: [String], format: "uuid" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID("all", { each: true })
  categoryIds!: string[];

  @ApiProperty({ description: "Recorded in the audit log." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}

/** Rename, or close (active: false) / reopen a route. */
export class UpdateRouteDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 150)
  name?: string;

  @ApiProperty({
    required: false,
    description:
      "false closes the route: no new bookings, subscription requests or generated trips. Existing bookings stay.",
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiProperty({ description: "Recorded in the audit log." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class EditedStopDto {
  @ApiProperty({
    required: false,
    format: "uuid",
    description: "Keep an existing stop (same name). Omit for a new stop.",
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty() @IsString() @Length(2, 150) name!: string;
}

/** The full new stop list, in outbound order. */
export class ReplaceStopsDto {
  @ApiProperty({ type: [EditedStopDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EditedStopDto)
  stops!: EditedStopDto[];

  @ApiProperty({ description: "Recorded in the audit log." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}
