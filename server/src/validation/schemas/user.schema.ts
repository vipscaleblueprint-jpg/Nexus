import { z } from 'zod';
import { EMPLOYMENT_TYPES, SYSTEM_ROLES } from '../../types';
import { httpUrl } from './common';

export const updateUserSchema = z
  .object({
    dailySheetUrl: httpUrl.nullable().optional(),
    starRating: z.number().int().min(1).max(3).optional(),
    primaryRole: z.string().nullable().optional(),
    secondaryRole: z.string().nullable().optional(),
    tertiaryRole: z.string().nullable().optional(),
    minorRole: z.string().nullable().optional(),
    systemRole: z.enum(SYSTEM_ROLES).optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field must be provided',
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
