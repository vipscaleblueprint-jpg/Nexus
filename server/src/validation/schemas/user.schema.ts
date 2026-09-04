import { z } from 'zod';
import { ROLE_TYPES, SYSTEM_ROLES } from '../../types';
import { httpUrl } from './common';

export const updateUserSchema = z
  .object({
    dailySheetUrl: httpUrl.nullable().optional(),
    starRating: z.number().int().min(1).max(3).optional(),
    primaryRole: z.enum(ROLE_TYPES).optional(),
    secondaryRole: z.enum(ROLE_TYPES).optional(),
    systemRole: z.enum(SYSTEM_ROLES).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field must be provided',
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
