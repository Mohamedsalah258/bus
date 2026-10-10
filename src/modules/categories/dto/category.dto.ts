import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from "class-validator";

export class CreateCategoryDto {
  @ApiProperty({
    example: "FACULTY_MEMBER",
    description: "Stable machine code: UPPER_SNAKE_CASE.",
  })
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  code!: string;

  @ApiProperty({ example: "عضو هيئة تدريس" })
  @IsString()
  @Length(2, 120)
  name!: string;
}

export class CategoryResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
}

/** Deactivating stops new registrations and subscription requests in it; nothing existing is revoked. */
export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiProperty({ description: "Recorded in the audit log." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}
