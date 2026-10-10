import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";
import {
  EGYPTIAN_MOBILE,
  normalizeEgyptianMobile,
} from "../../auth/dto/profile.dto.js";

class FleetReason {
  @ApiProperty({ description: "Recorded in the audit log." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}

/** Only the fields sent change. Existing trips keep their own capacity. */
export class UpdateVehicleDto extends FleetReason {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 30)
  plate?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  capacity?: number;

  @ApiPropertyOptional({
    description: "false is refused while upcoming trips or routes use it.",
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateDriverDto extends FleetReason {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 150)
  name?: string;

  @ApiPropertyOptional({ example: "01012345678" })
  @IsOptional()
  @Transform(normalizeEgyptianMobile)
  @Matches(EGYPTIAN_MOBILE, {
    message: "phone must be an Egyptian mobile number",
  })
  phone?: string;

  @ApiPropertyOptional({
    description: "false is refused while upcoming trips or routes use them.",
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
