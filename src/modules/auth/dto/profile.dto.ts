import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, IsUUID, Length, Matches } from "class-validator";

/** Accepts 01xxxxxxxxx, +201xxxxxxxxx or 00201xxxxxxxxx; stores 01xxxxxxxxx. */
export const normalizeEgyptianMobile = ({ value }: { value: unknown }) =>
  typeof value === "string"
    ? value.replace(/[\s-]/g, "").replace(/^(\+20|0020)/, "0")
    : value;

export const EGYPTIAN_MOBILE = /^01[0125]\d{8}$/;

/** Every field optional: only what is sent changes. */
export class UpdateProfileDto {
  @ApiPropertyOptional({ description: "Full name (الاسم رباعي)." })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ example: "01012345678" })
  @IsOptional()
  @Transform(normalizeEgyptianMobile)
  @Matches(EGYPTIAN_MOBILE, {
    message: "phone must be an Egyptian mobile number",
  })
  phone?: string;

  @ApiPropertyOptional({ description: "Job title (الوظيفة)." })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  jobTitle?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Members only." })
  @IsOptional()
  @IsUUID()
  facultyId?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Members only." })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
