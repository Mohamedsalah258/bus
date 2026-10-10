import { applyDecorators } from "@nestjs/common";
import { IsDateString, Matches } from "class-validator";

/** Calendar date in `YYYY-MM-DD` form, without time or zone. */
export const IsCalendarDate = () =>
  applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}$/),
    IsDateString({ strict: true }),
  );
