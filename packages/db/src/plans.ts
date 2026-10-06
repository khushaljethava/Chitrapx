export type Plan = "free" | "pro" | "studio";

/** `maxSeats` (SP15): members of every role plus pending invites. */
export type PlanLimits = { monthlyCredits: number; maxApps: number; maxProjects: number; maxSeats: number };

/** Launch values; business-tunable. The only place plan limits are defined. */
export const PLANS: Record<Plan, PlanLimits> = {
  free: { monthlyCredits: 50, maxApps: 1, maxProjects: 3, maxSeats: 1 },
  pro: { monthlyCredits: 1000, maxApps: 10, maxProjects: Infinity, maxSeats: 3 },
  studio: { monthlyCredits: 5000, maxApps: Infinity, maxProjects: Infinity, maxSeats: 10 },
};
