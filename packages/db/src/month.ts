/** 'YYYY-MM' in UTC; the idempotency key for monthly grants. */
export const monthKey = (d: Date): string => d.toISOString().slice(0, 7);
