/** Largest estimate accepted for one task: anything bigger is a typo, not a plan. */
export const MAX_ESTIMATED_HOURS = 1000;

/**
 * Reads an "estimated hours" value from a request (Galaxy's estimated_hours or a PM's edit).
 *   number / numeric string > 0  -> hours, rounded to the nearest quarter hour (min 0.25)
 *   null / ''                    -> null (clear the estimate)
 *   undefined / anything invalid -> undefined (leave the stored value alone)
 */
export function parseEstimatedHours(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const n = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(n) || n <= 0 || n > MAX_ESTIMATED_HOURS) return undefined;
  return Math.max(0.25, Math.round(n * 4) / 4);
}
