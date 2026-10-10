export const PlanPeriod = { Annual: "ANNUAL", Term: "TERM" } as const;
export type PlanPeriod = (typeof PlanPeriod)[keyof typeof PlanPeriod];
export const PLAN_PERIODS = Object.values(PlanPeriod);
