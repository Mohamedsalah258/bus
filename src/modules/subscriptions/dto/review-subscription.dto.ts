import { ApiProperty } from "@nestjs/swagger";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";
import { IsCalendarDate } from "../../../common/validation/is-calendar-date.decorator.js";
import {
  PAYMENT_METHODS,
  PaymentMethod,
  REVIEW_DECISIONS,
  ReviewDecision,
} from "../subscription-status.js";

export class ReasonDto {
  @ApiProperty({ description: "Shown to the applicant and audited." })
  @IsString()
  @Length(3, 1000)
  reason!: string;
}

export class ReviewSubscriptionDto extends ReasonDto {
  @ApiProperty({
    enum: REVIEW_DECISIONS,
    description: "NEEDS_INFO asks the applicant to complete and resubmit.",
  })
  @IsIn(REVIEW_DECISIONS)
  status!: ReviewDecision;
}

export class ResubmitSubscriptionDto {
  @ApiProperty({ description: "What was completed, for the reviewer." })
  @IsString()
  @Length(3, 1000)
  note!: string;
}

export class RecordPaymentDto {
  @ApiProperty({ description: "Piasters (EGP × 100).", example: 150000 })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amountMinor!: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  @ApiProperty({ required: false, description: "Receipt or transfer number." })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  reference?: string;

  @ApiProperty({ example: "2026-10-08" }) @IsCalendarDate() paidOn!: string;
}

export class RecordRefundDto extends RecordPaymentDto {
  @ApiProperty({ description: "Why the money is returned; audited." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}
