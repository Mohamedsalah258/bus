import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, Length } from "class-validator";
import { LoginDto } from "./login.dto.js";

/**
 * Role is intentionally absent: extra fields are rejected by validation.
 * The category is self-declared; an administrator verifies eligibility
 * before approving any subscription.
 */
export class RegisterDto extends LoginDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string;

  @ApiProperty({ format: "uuid" }) @IsUUID() facultyId!: string;

  @ApiProperty({ format: "uuid", description: "From GET /categories." })
  @IsUUID()
  categoryId!: string;
}
