export type Plan = "free" | "pro" | "studio";

export type PlanLimits = { monthlyCredits: number; maxApps: number; maxProjects: number };

/** Launch values; business-tunable. The only place plan limits are defined. */
export const PLANS: Record<Plan, PlanLimits> = {
  free: { monthlyCredits: 50, maxApps: 1, maxProjects: 3 },
  pro: { monthlyCredits: 1000, maxApps: 10, maxProjects: Infinity },
  studio: { monthlyCredits: 5000, maxApps: Infinity, maxProjects: Infinity },
};
