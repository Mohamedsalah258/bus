import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class CreateFacultyDto {
  @ApiProperty() @IsString() @Length(2, 150) name!: string;
}

export class UpdateFacultyDto extends CreateFacultyDto {
  @ApiProperty({ description: "Recorded in the audit log." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}
