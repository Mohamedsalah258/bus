import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength } from "class-validator";

export class RefreshDto {
  @ApiProperty({
    description: "The refresh token from login or the last refresh.",
  })
  @IsString()
  @MaxLength(128)
  refreshToken!: string;
}
