import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, Length, Matches } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto.js";
import { IsCalendarDate } from "../../../common/validation/is-calendar-date.decorator.js";

export class ListAuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: "BOOKING_CANCELLED_BY_ADMIN" })
  @IsOptional()
  @IsString()
  @Length(3, 60)
  @Matches(/^[A-Z_]+$/)
  action?: string;

  @ApiPropertyOptional({ format: "uuid", description: "The record acted on." })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Who did it." })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ description: "Cairo date, inclusive." })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({ description: "Cairo date, inclusive." })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}
