import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class CreateBookingDto {
  @ApiProperty() @IsUUID() tripId!: string;

  @ApiProperty() @IsUUID() boardingStopId!: string;

  @ApiProperty({
    description:
      "Generate one UUID per booking attempt. Reuse the SAME value only when retrying that request.",
  })
  @IsUUID()
  idempotencyKey!: string;
}
