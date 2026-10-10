import { ApiProperty } from "@nestjs/swagger";

export class DriverResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty() active!: boolean;
}
