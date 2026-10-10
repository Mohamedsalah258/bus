/** SQLSTATE codes translated into client-safe HTTP errors. */
export const PostgresErrorCode = {
  UniqueViolation: "23505",
  ForeignKeyViolation: "23503",
  CheckViolation: "23514",
  InvalidDatetimeFormat: "22007",
  DatetimeFieldOverflow: "22008",
} as const;
