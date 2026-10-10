/** Day names ↔ PostgreSQL DOW (0 = Sunday). The university week starts Saturday. */
export const WEEKDAYS = [
  "SAT",
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const DOW: Record<Weekday, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export const toDow = (days: readonly Weekday[]) =>
  [...new Set(days.map((d) => DOW[d]))].sort((a, b) => a - b);

/** Back to names, in university order (Saturday first). */
export const fromDow = (dows: readonly number[]) =>
  WEEKDAYS.filter((d) => dows.includes(DOW[d]));
