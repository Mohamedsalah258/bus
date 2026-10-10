import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, Length, Matches } from "class-validator";
import {
  EGYPTIAN_MOBILE,
  normalizeEgyptianMobile,
} from "../../auth/dto/profile.dto.js";

export class CreateDriverDto {
  @ApiProperty() @IsString() @Length(2, 150) name!: string;

  @ApiPropertyOptional({
    example: "01012345678",
    description: "Shown only to passengers with a confirmed booking.",
  })
  @IsOptional()
  @Transform(normalizeEgyptianMobile)
  @Matches(EGYPTIAN_MOBILE, {
    message: "phone must be an Egyptian mobile number",
  })
  phone?: string;
}
