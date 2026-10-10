import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, IsUUID, Length, Matches } from "class-validator";
import {
  EGYPTIAN_MOBILE,
  normalizeEgyptianMobile,
} from "../../auth/dto/profile.dto.js";

/**
 * The old site's subscription form, minus the national ID and address:
 * profile and request submitted together.
 */
export class ApplySubscriptionDto {
  @ApiProperty({ description: "الاسم رباعي" })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ example: "01012345678" })
  @Transform(normalizeEgyptianMobile)
  @Matches(EGYPTIAN_MOBILE, {
    message: "phone must be an Egyptian mobile number",
  })
  phone!: string;

  @ApiPropertyOptional({ description: "الوظيفة" })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  jobTitle?: string;

  @ApiProperty({ format: "uuid", description: "الكلية" })
  @IsUUID()
  facultyId!: string;

  @ApiProperty({ format: "uuid", description: "الفئة" })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ format: "uuid", description: "From GET /plans." })
  @IsUUID()
  planId!: string;

  @ApiProperty({ format: "uuid", description: "خط السير" })
  @IsUUID()
  routeId!: string;
}
