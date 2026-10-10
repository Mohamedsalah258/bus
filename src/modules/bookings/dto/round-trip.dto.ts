import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ValidateNested } from "class-validator";
import { BookingResponse } from "./booking.response.js";
import { CreateBookingDto } from "./create-booking.dto.js";

/** Each leg has its own idempotency key; on the return, the stop is where you get off. */
export class CreateRoundTripDto {
  @ApiProperty({ type: CreateBookingDto })
  @ValidateNested()
  @Type(() => CreateBookingDto)
  outbound!: CreateBookingDto;

  @ApiProperty({ type: CreateBookingDto })
  @ValidateNested()
  @Type(() => CreateBookingDto)
  return!: CreateBookingDto;
}

export class RoundTripResponse {
  @ApiProperty({ type: BookingResponse }) outbound!: BookingResponse;
  @ApiProperty({ type: BookingResponse }) return!: BookingResponse;
}
