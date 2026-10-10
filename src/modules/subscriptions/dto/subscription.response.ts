import { ApiProperty } from "@nestjs/swagger";
import {
  PAYMENT_METHODS,
  PaymentMethod,
  PaymentStatus,
  SUBSCRIPTION_STATUSES,
  SubscriptionStatus,
} from "../subscription-status.js";

export class SubscriptionResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ format: "uuid" }) seasonId!: string;
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  planId!: string | null;
  @ApiProperty({ format: "uuid" }) routeId!: string;
  @ApiProperty({ enum: SUBSCRIPTION_STATUSES }) status!: SubscriptionStatus;
  @ApiProperty({ description: "Plan dates have passed (Cairo)." })
  expired!: boolean;
  @ApiProperty({ format: "date" }) coversFrom!: string;
  @ApiProperty({ format: "date" }) coversUntil!: string;
  @ApiProperty({ description: "Piasters; 0 = free." }) feeMinor!: number;
  @ApiProperty({ description: "Net: payments minus reversals and refunds." })
  paidMinor!: number;
  @ApiProperty({ enum: Object.values(PaymentStatus) })
  paymentStatus!: PaymentStatus;
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  reviewedBy!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  reviewedAt!: Date | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: "Latest staff reason.",
  })
  reviewReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) applicantNote!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: Date;
}

/** Review-queue item: the request plus who is asking and for what. */
export class SubscriptionReviewItemResponse extends SubscriptionResponse {
  @ApiProperty() applicantName!: string;
  @ApiProperty() applicantEmail!: string;
  @ApiProperty({ nullable: true, type: String }) applicantPhone!: string | null;
  @ApiProperty({ nullable: true, type: String, description: "الوظيفة" })
  applicantJobTitle!: string | null;
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  applicantFacultyId!: string | null;
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  applicantCategoryId!: string | null;
  @ApiProperty() routeName!: string;
  @ApiProperty() planName!: string;
}

export class PaymentResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({
    enum: ["PAYMENT", "REVERSAL", "REFUND"],
    description:
      "REVERSAL cancels a mistaken PAYMENT; REFUND is money handed back.",
  })
  kind!: "PAYMENT" | "REVERSAL" | "REFUND";
  @ApiProperty({
    description: "Always positive; REVERSAL and REFUND subtract.",
  })
  amountMinor!: number;
  @ApiProperty({ enum: PAYMENT_METHODS }) method!: PaymentMethod;
  @ApiProperty({ nullable: true, type: String }) reference!: string | null;
  @ApiProperty({ format: "date" }) paidOn!: string;
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  reversesPaymentId!: string | null;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty({ format: "uuid" }) recordedBy!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
}

export class SubscriptionDetailResponse extends SubscriptionReviewItemResponse {
  @ApiProperty({ type: [PaymentResponse] }) payments!: PaymentResponse[];
}
