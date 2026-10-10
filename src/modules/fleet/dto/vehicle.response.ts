import { ApiProperty } from "@nestjs/swagger";

export class VehicleResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() plate!: string;
  @ApiProperty() capacity!: number;
  @ApiProperty() active!: boolean;
}
