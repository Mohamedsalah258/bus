import { ApiProperty } from "@nestjs/swagger";

export class RouteStopResponse {
  @ApiProperty({ format: "uuid", description: "Use as boardingStopId." })
  id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: "0-based outbound order." }) position!: number;
}

export class RouteResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ description: "Bumped by every change of the stop list." })
  version!: number;
  @ApiProperty({ type: [RouteStopResponse] }) stops!: RouteStopResponse[];
  @ApiProperty({ type: [String], format: "uuid" })
  eligibleCategoryIds!: string[];
  @ApiProperty({
    format: "uuid",
    nullable: true,
    type: String,
    description: "Bus normally assigned; recurring scheduling uses it.",
  })
  defaultVehicleId!: string | null;
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  defaultDriverId!: string | null;
}

export class RouteUpdateResponse extends RouteResponse {
  @ApiProperty({
    description:
      "Upcoming trips still scheduled on the route; cancel them if it is closed for good.",
  })
  upcomingTrips!: number;
}
