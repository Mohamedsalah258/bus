import { ApiProperty } from "@nestjs/swagger";

export class AuditEventResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid", nullable: true, type: String })
  actorId!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty({ format: "uuid" }) entityId!: string;
  @ApiProperty({ type: Object }) metadata!: Record<string, unknown>;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
}
