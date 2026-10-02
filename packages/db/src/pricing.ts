/** Credits charged per job type. The only place prices are defined. */
export const PRICES = {
  noop: 1,
  /** One run renders every board in every locale into a ZIP. */
  export: 1,
} as const;

export type JobType = keyof typeof PRICES;
