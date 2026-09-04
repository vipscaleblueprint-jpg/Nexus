import { z } from 'zod';

/** Shared field builders, so every schema spells the same rule the same way. */

export const uuid = z.string().uuid('must be a valid uuid');

/** Optional uuid that also accepts an explicit null (used to clear a relation). */
export const nullableUuid = uuid.nullable().optional();

export const shortText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);

export const longText = (max = 10_000) => z.string().max(max, `must be at most ${max} characters`);

/** An ISO date string (or null); controllers convert to Date. */
export const isoDate = z
  .string()
  .datetime({ offset: true, message: 'must be an ISO 8601 date string' });

export const nullableIsoDate = isoDate.nullable().optional();

export const httpUrl = z.string().url('must be a valid URL');

/** Query strings arrive as text, so booleans and numbers need coercing. */
export const boolQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: uuid.optional(),
});

/**
 * Rejects a body that is entirely empty, for PATCH routes where sending
 * nothing is always a mistake rather than a no-op.
 */
export function nonEmpty<T extends z.ZodTypeAny>(schema: T) {
  return schema.refine(
    (value) => value && typeof value === 'object' && Object.keys(value).length > 0,
    { message: 'at least one field must be provided' }
  );
}
