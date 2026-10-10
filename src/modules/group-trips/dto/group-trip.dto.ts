import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto.js";
import { IsZonedTimestamp } from "../../../common/validation/is-zoned-timestamp.decorator.js";
import {
  EGYPTIAN_MOBILE,
  normalizeEgyptianMobile,
} from "../../auth/dto/profile.dto.js";
import { TripResponse } from "../../trips/dto/trip.response.js";
import { GROUP_TRIP_STATUSES, GroupTripStatus } from "../group-trip-status.js";

/** The old «استمارة حجز رحلة (الأنشطة الطلابية)», minus national ID and academic year. */
export class CreateGroupTripDto {
  @ApiProperty({ description: "الاسم رباعي" })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ example: "01012345678" })
  @Transform(normalizeEgyptianMobile)
  @Matches(EGYPTIAN_MOBILE, {
    message: "phone must be an Egyptian mobile number",
  })
  phone!: string;

  @ApiProperty({ format: "uuid", description: "الكلية" })
  @IsUUID()
  facultyId!: string;

  @ApiProperty({
    example: "اتحاد طلاب كلية العلوم",
    description: "الجهة المنظمة",
  })
  @IsString()
  @Length(2, 150)
  organization!: string;

  @ApiProperty({ example: "رحلة علمية", description: "الغرض" })
  @IsString()
  @Length(3, 300)
  purpose!: string;

  @ApiProperty({ example: "متحف الحضارة - القاهرة", description: "جهة الرحلة" })
  @IsString()
  @Length(2, 200)
  destination!: string;

  @ApiPropertyOptional({ description: "تفاصيل الرحلة" })
  @IsOptional()
  @IsString()
  @Length(0, 4000)
  details?: string;

  @ApiProperty({
    example: "البوابة الرئيسية للجامعة",
    description: "مكان التجمع",
  })
  @IsString()
  @Length(2, 200)
  pickupLocation!: string;

  @ApiProperty({ example: 45, description: "عدد الأشخاص" })
  @IsInt()
  @Min(1)
  @Max(500)
  passengers!: number;

  @ApiProperty({
    example: "2026-11-12T07:00:00+02:00",
    description: "موعد الذهاب",
  })
  @IsZonedTimestamp()
  departureAt!: string;

  @ApiProperty({
    example: "2026-11-12T18:00:00+02:00",
    description: "موعد العودة",
  })
  @IsZonedTimestamp()
  returnAt!: string;
}

export class GroupTripAssignmentDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() vehicleId!: string;
  @ApiProperty({ format: "uuid" }) @IsUUID() driverId!: string;
}

export class ApproveGroupTripDto {
  @ApiProperty({
    type: [GroupTripAssignmentDto],
    description: "One or more buses; total seats must cover the group.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => GroupTripAssignmentDto)
  assignments!: GroupTripAssignmentDto[];

  @ApiProperty({ description: "Shown to the requester." })
  @IsString()
  @Length(3, 1000)
  reason!: string;
}

export class GroupTripReasonDto {
  @ApiProperty({ description: "Shown to the requester and audited." })
  @IsString()
  @Length(3, 1000)
  reason!: string;
}

export class GroupTripNoteDto {
  @ApiProperty({ description: "What was completed or changed." })
  @IsString()
  @Length(3, 1000)
  note!: string;
}

export class ListGroupTripsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: GROUP_TRIP_STATUSES })
  @IsOptional()
  @IsIn(GROUP_TRIP_STATUSES)
  status?: GroupTripStatus;
}

export class GroupTripResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "G-2026-000001" }) reference!: string;
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ nullable: true, type: String }) requesterName!: string | null;
  @ApiProperty() requesterEmail!: string;
  @ApiProperty({ nullable: true, type: String }) requesterPhone!: string | null;
  @ApiProperty({ format: "uuid", nullable: true, type: String }) facultyId!:
    string | null;
  @ApiProperty() organization!: string;
  @ApiProperty() purpose!: string;
  @ApiProperty() destination!: string;
  @ApiProperty({ nullable: true, type: String }) details!: string | null;
  @ApiProperty() pickupLocation!: string;
  @ApiProperty() passengers!: number;
  @ApiProperty({ type: String, format: "date-time" }) departureAt!: Date;
  @ApiProperty({ type: String, format: "date-time" }) returnAt!: Date;
  @ApiProperty({ enum: GROUP_TRIP_STATUSES }) status!: GroupTripStatus;
  @ApiProperty({ nullable: true, type: String }) decisionReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) applicantNote!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
}

export class GroupTripDetailResponse extends GroupTripResponse {
  @ApiProperty({
    type: [TripResponse],
    description: "Trips holding the assigned buses (after approval).",
  })
  trips!: TripResponse[];
}
