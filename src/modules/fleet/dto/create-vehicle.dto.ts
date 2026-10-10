import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsString, Length, Max, Min } from "class-validator";

export class CreateVehicleDto {
  @ApiProperty() @IsString() @Length(2, 30) plate!: string;

  @ApiProperty({ minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  capacity!: number;
}
