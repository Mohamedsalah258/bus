import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsString, Length, Matches, MaxLength } from "class-validator";

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class EmailCodeDto {
  @ApiProperty({ example: "123456" })
  @Matches(/^\d{6}$/, { message: "code must be 6 digits" })
  code!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordWithCodeDto extends ForgotPasswordDto {
  @ApiProperty({ example: "123456" })
  @Matches(/^\d{6}$/, { message: "code must be 6 digits" })
  code!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128)
  newPassword!: string;
}

export class AcceptedResponse {
  @ApiProperty() message!: string;
}

export class SignInCodeRequestDto {
  @ApiProperty({ example: "name@bsu.edu.eg" })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class SignInCodeVerifyDto extends SignInCodeRequestDto {
  @ApiProperty({ example: "123456" })
  @Matches(/^\d{6}$/, { message: "code must be 6 digits" })
  code!: string;
}
