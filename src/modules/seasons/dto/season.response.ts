import { ApiProperty } from "@nestjs/swagger";

export class SeasonResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: "date", example: "2026-10-01" }) startsOn!: string;
  @ApiProperty({ format: "date", example: "2027-09-30" }) endsOn!: string;
}
