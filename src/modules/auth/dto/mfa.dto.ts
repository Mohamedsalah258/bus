import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsJWT, IsOptional, IsString, Length, Matches } from "class-validator";

export class MfaCodeDto {
  @ApiProperty({ example: "123456" })
  @Matches(/^\d{6}$/, { message: "code must be 6 digits" })
  code!: string;
}

/** Send exactly one of `code` or `recoveryCode`. */
export class MfaVerifyDto {
  @ApiProperty() @IsJWT() mfaToken!: string;

  @ApiPropertyOptional({ example: "123456" })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: "code must be 6 digits" })
  code?: string;

  @ApiPropertyOptional({ example: "abcde-fghjk" })
  @IsOptional()
  @IsString()
  @Length(10, 20)
  recoveryCode?: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @Length(1, 128) currentPassword!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128)
  newPassword!: string;
}
