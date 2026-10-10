import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto.js";

export class ListRoutesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: "Include closed routes (staff with routes:manage only).",
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value,
  )
  @IsBoolean()
  includeInactive?: boolean;
}
