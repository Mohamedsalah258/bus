import { Type, applyDecorators } from "@nestjs/common";
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  getSchemaPath,
} from "@nestjs/swagger";
import { PaginationQueryDto } from "./pagination-query.dto.js";

/** Envelope for every list endpoint. */
export class PageDto<T> {
  items!: T[];

  @ApiProperty({ description: "Total matching records, ignoring paging." })
  total!: number;

  @ApiProperty() limit!: number;

  @ApiProperty() offset!: number;
}

export function toPage<T>(
  items: T[],
  total: number,
  page: PaginationQueryDto,
): PageDto<T> {
  return { items, total, limit: page.limit, offset: page.offset };
}

/** Documents a `PageDto<Model>` 200 response in OpenAPI. */
export const ApiPageResponse = <M extends Type<unknown>>(model: M) =>
  applyDecorators(
    ApiExtraModels(PageDto, model),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(PageDto) },
          {
            properties: {
              items: { type: "array", items: { $ref: getSchemaPath(model) } },
            },
            required: ["items"],
          },
        ],
      },
    }),
  );
