import { applyDecorators } from "@nestjs/common";
import { IsDateString, Matches } from "class-validator";

/** ISO-8601 timestamp that carries `Z` or an explicit UTC offset. */
export const IsZonedTimestamp = () =>
  applyDecorators(
    IsDateString({ strict: true }),
    Matches(/T.*(Z|[+-]\d{2}:\d{2})$/),
  );
