import { NextFunction, Request, Response } from 'express';
import { z, ZodError, ZodSchema } from 'zod';

/**
 * Route-level request validation.
 *
 * `validate({ body, params, query })` checks each part that is supplied and
 * replaces it with the parsed result, so defaults, coercions and stripping of
 * unknown keys are visible to the controller. Controllers downstream can treat
 * their inputs as already-valid and correctly typed.
 *
 * A failure short-circuits with 400 and never reaches the handler:
 *
 *   { "error": "Validation failed",
 *     "details": [{ "path": "body.email", "message": "Invalid email" }] }
 */

export interface RequestSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

export interface ValidationDetail {
  path: string;
  message: string;
}

function details(part: keyof RequestSchemas, err: ZodError): ValidationDetail[] {
  return err.errors.map((issue) => ({
    path: [part, ...issue.path].join('.'),
    message: issue.message,
  }));
}

export function validate(schemas: RequestSchemas) {
  const parts = Object.keys(schemas) as (keyof RequestSchemas)[];

  return (req: Request, res: Response, next: NextFunction) => {
    const problems: ValidationDetail[] = [];

    for (const part of parts) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (result.success) {
        // Express 4 exposes these as plain writable properties, so the parsed
        // value (with defaults applied) is what the controller sees.
        req[part] = result.data as any;
      } else {
        problems.push(...details(part, result.error));
      }
    }

    if (problems.length > 0) {
      req.log?.warn(
        { validation: problems },
        `Validation failed: ${problems.map((p) => `${p.path} ${p.message}`).join('; ')}`
      );
      return res.status(400).json({ error: 'Validation failed', details: problems });
    }

    next();
  };
}

/** Shorthand for the common case of validating only the JSON body. */
export function validateBody(schema: ZodSchema) {
  return validate({ body: schema });
}

/** `:id` route params, used by nearly every resource route. */
export const idParams = z.object({
  id: z.string().uuid('must be a valid uuid'),
});

export const idAndSubtaskIdParams = z.object({
  id: z.string().uuid('must be a valid uuid'),
  subtaskId: z.string().uuid('must be a valid uuid'),
});
