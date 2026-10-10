import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class CreateSubscriptionDto {
  @ApiProperty({ format: "uuid", description: "From GET /plans." })
  @IsUUID()
  planId!: string;

  @ApiProperty({ format: "uuid" }) @IsUUID() routeId!: string;
}
