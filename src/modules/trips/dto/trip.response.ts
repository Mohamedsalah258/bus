import { RouteStopResponse } from "../../routes/dto/route.response.js";
import { ApiProperty } from "@nestjs/swagger";
import { TRIP_STATUSES, TripDirection, TripStatus } from "../trip.constants.js";

/** Fields every viewer of a trip may see. */
export class TripSummaryResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({
    format: "uuid",
    nullable: true,
    type: String,
    description: "Null for group trips.",
  })
  routeId!: string | null;
  @ApiProperty({ enum: Object.values(TripDirection) })
  direction!: TripDirection;
  @ApiProperty({ type: String, format: "date-time" }) departureAt!: Date;
  @ApiProperty({ type: String, format: "date-time" }) arrivalAt!: Date;
  @ApiProperty({ type: String, format: "date-time" }) bookingClosesAt!: Date;
  @ApiProperty({ type: String, format: "date-time" })
  cancellationClosesAt!: Date;
  @ApiProperty() capacity!: number;
  @ApiProperty({ enum: TRIP_STATUSES }) status!: TripStatus;
}

export class TripListItemResponse extends TripSummaryResponse {
  @ApiProperty({
    description: "Advisory: the server re-checks capacity when booking.",
  })
  remainingSeats!: number;

  @ApiProperty({
    type: [RouteStopResponse],
    description:
      "In travel order: toward the university for OUTBOUND, reversed for RETURN.",
  })
  stops!: RouteStopResponse[];
}

/** Full record for staff, including the assignment. */
export class TripResponse extends TripSummaryResponse {
  @ApiProperty({ format: "uuid" }) vehicleId!: string;
  @ApiProperty({ format: "uuid" }) driverId!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: Date;
  @ApiProperty({ nullable: true, type: String }) cancelReason!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  cancelledAt!: Date | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  startedAt!: Date | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  completedAt!: Date | null;
  @ApiProperty({ enum: ["SCHEDULED", "GROUP"] }) kind!: "SCHEDULED" | "GROUP";
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  groupRequestId!: string | null;
}

/** Staff schedule row: full record plus how many seats are taken. */
export class TripScheduleItemResponse extends TripResponse {
  @ApiProperty() confirmedBookings!: number;
}

export class TripCancellationResponse extends TripResponse {
  @ApiProperty({ description: "Bookings cancelled and passengers emailed." })
  cancelledBookings!: number;
}
