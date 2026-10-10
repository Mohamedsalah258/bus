import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto.js";
import { NotificationTemplate } from "../notification-template.js";

const STATUSES = ["PENDING", "SENDING", "SENT", "FAILED"] as const;
const TEMPLATES = Object.values(NotificationTemplate);

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: STATUSES, default: "FAILED" })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @ApiPropertyOptional({ enum: TEMPLATES })
  @IsOptional()
  @IsIn(TEMPLATES)
  template?: NotificationTemplate;
}

/** Delivery metadata only: the message content is never exposed here. */
export class NotificationResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() toEmail!: string;
  @ApiProperty({ enum: TEMPLATES }) template!: NotificationTemplate;
  @ApiProperty({ enum: STATUSES }) status!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty({ nullable: true, type: String }) lastError!: string | null;
  @ApiProperty({
    description:
      "One-time codes cannot be resent; the user requests a new one.",
  })
  retryable!: boolean;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  sentAt!: Date | null;
}
