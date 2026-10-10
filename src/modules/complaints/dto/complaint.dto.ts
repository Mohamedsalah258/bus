import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto.js";
import {
  COMPLAINT_KINDS,
  COMPLAINT_STATUSES,
  ComplaintKind,
  ComplaintStatus,
} from "../complaint-status.js";

export class CreateComplaintDto {
  @ApiProperty({ enum: COMPLAINT_KINDS })
  @IsIn(COMPLAINT_KINDS)
  kind!: ComplaintKind;

  @ApiProperty({ example: "تأخر الأتوبيس عن الموعد" })
  @IsString()
  @Length(3, 150)
  subject!: string;

  @ApiProperty() @IsString() @Length(5, 4000) body!: string;

  @ApiPropertyOptional({ format: "uuid", description: "A trip you booked." })
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @ApiPropertyOptional({
    format: "uuid",
    description: "One of your subscriptions.",
  })
  @IsOptional()
  @IsUUID()
  subscriptionId?: string;
}

export class ComplaintMessageDto {
  @ApiProperty() @IsString() @Length(1, 4000) body!: string;

  @ApiPropertyOptional({
    default: false,
    description: "Staff only: a note the author never sees.",
  })
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}

export class ResolveComplaintDto {
  @ApiProperty({ description: "The answer sent to the author." })
  @IsString()
  @Length(3, 4000)
  message!: string;
}

export class AssignComplaintDto {
  @ApiProperty({
    format: "uuid",
    description: "A staff member who handles complaints.",
  })
  @IsUUID()
  assigneeId!: string;
}

export class ListComplaintsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: COMPLAINT_STATUSES })
  @IsOptional()
  @IsIn(COMPLAINT_STATUSES)
  status?: ComplaintStatus;

  @ApiPropertyOptional({ enum: COMPLAINT_KINDS })
  @IsOptional()
  @IsIn(COMPLAINT_KINDS)
  kind?: ComplaintKind;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;
}

export class ComplaintMessageResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() fromStaff!: boolean;
  @ApiProperty({
    nullable: true,
    type: String,
    description: "Staff names are shown; null for the author.",
  })
  authorName!: string | null;
  @ApiProperty() internal!: boolean;
  @ApiProperty() body!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
}

export class ComplaintResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "C-2026-000123" }) reference!: string;
  @ApiProperty({ enum: COMPLAINT_KINDS }) kind!: ComplaintKind;
  @ApiProperty() subject!: string;
  @ApiProperty({ enum: COMPLAINT_STATUSES }) status!: ComplaintStatus;
  @ApiProperty({ format: "uuid", nullable: true, type: String }) tripId!:
    string | null;
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  subscriptionId!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: Date;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  resolvedAt!: Date | null;
}

/** Staff view: who filed it and who handles it. */
export class ComplaintStaffItemResponse extends ComplaintResponse {
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ nullable: true, type: String }) authorName!: string | null;
  @ApiProperty() authorEmail!: string;
  @ApiProperty({ nullable: true, type: String }) authorPhone!: string | null;
  @ApiProperty({ format: "uuid", nullable: true, type: String }) assignedTo!:
    string | null;
}

export class ComplaintDetailResponse extends ComplaintStaffItemResponse {
  @ApiProperty({ type: [ComplaintMessageResponse] })
  messages!: ComplaintMessageResponse[];
}
