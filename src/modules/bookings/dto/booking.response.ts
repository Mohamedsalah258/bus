import { ApiProperty } from "@nestjs/swagger";
import { TripDirection } from "../../trips/trip.constants.js";
import { BOOKING_STATUSES, BookingStatus } from "../booking-status.js";

export class BookingResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ format: "uuid" }) tripId!: string;
  @ApiProperty({ format: "uuid" }) boardingStopId!: string;
  @ApiProperty({ enum: BOOKING_STATUSES }) status!: BookingStatus;
  @ApiProperty({ format: "uuid" }) idempotencyKey!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  cancelledAt!: Date | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: "Set when staff cancelled the booking.",
  })
  cancelReason!: string | null;
  @ApiProperty({
    format: "uuid",
    nullable: true,
    type: String,
    description: "Shared by the two legs of a round trip.",
  })
  pairId!: string | null;
}

export class MyBookingResponse extends BookingResponse {
  @ApiProperty({ type: String, format: "date-time" }) departureAt!: Date;
  @ApiProperty({ type: String, format: "date-time" }) arrivalAt!: Date;
  @ApiProperty({ enum: Object.values(TripDirection) })
  direction!: TripDirection;
  @ApiProperty() routeName!: string;
  @ApiProperty() boardingStopName!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      "Only while the booking is confirmed and the trip not finished.",
  })
  driverName!: string | null;
  @ApiProperty({ nullable: true, type: String }) driverPhone!: string | null;
}
