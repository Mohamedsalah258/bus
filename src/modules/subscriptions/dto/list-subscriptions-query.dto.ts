import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto.js";
import {
  SUBSCRIPTION_STATUSES,
  SubscriptionStatus,
} from "../subscription-status.js";

export class ListSubscriptionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: SUBSCRIPTION_STATUSES,
    description: "e.g. PENDING for the review queue.",
  })
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES)
  status?: SubscriptionStatus;
}
