import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto.js";
import { IsZonedTimestamp } from "../../../common/validation/is-zoned-timestamp.decorator.js";

export const NEWS_KINDS = ["NEWS", "ALERT"] as const;
export type NewsKind = (typeof NEWS_KINDS)[number];

export class CreateNewsDto {
  @ApiProperty({
    enum: NEWS_KINDS,
    description: "ALERT for service notices (delays, changes).",
  })
  @IsIn(NEWS_KINDS)
  kind!: NewsKind;

  @ApiProperty() @IsString() @Length(3, 200) title!: string;
  @ApiProperty() @IsString() @Length(3, 10000) body!: string;

  @ApiPropertyOptional({
    format: "uuid",
    description: "Ties an alert to one route.",
  })
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @ApiPropertyOptional({ description: "Schedule for later; default now." })
  @IsOptional()
  @IsZonedTimestamp()
  publishedAt?: string;

  @ApiPropertyOptional({ description: "Hidden automatically after this time." })
  @IsOptional()
  @IsZonedTimestamp()
  expiresAt?: string;
}

export class UpdateNewsDto extends PartialType(CreateNewsDto) {
  @ApiPropertyOptional({ description: "false hides the post." })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListNewsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NEWS_KINDS })
  @IsOptional()
  @IsIn(NEWS_KINDS)
  kind?: NewsKind;
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: "Staff only: include hidden, scheduled and expired posts.",
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value,
  )
  @IsBoolean()
  includeHidden?: boolean;
}

export class NewsResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: NEWS_KINDS }) kind!: NewsKind;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ format: "uuid", nullable: true, type: String }) routeId!:
    string | null;
  @ApiProperty() pinned!: boolean;
  @ApiProperty({ type: String, format: "date-time" }) publishedAt!: Date;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  expiresAt!: Date | null;
  @ApiProperty() active!: boolean;
}
