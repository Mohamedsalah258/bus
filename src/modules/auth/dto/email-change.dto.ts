import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, Matches, MaxLength } from "class-validator";

export class EmailChangeRequestDto {
  @ApiProperty()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  newEmail!: string;
}

export class EmailChangeConfirmDto {
  @ApiProperty({
    example: "123456",
    description: "The code sent to the new address.",
  })
  @Matches(/^\d{6}$/, { message: "code must be 6 digits" })
  code!: string;
}
