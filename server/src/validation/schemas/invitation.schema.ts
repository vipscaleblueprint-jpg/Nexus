import { z } from 'zod';
import { EMPLOYMENT_TYPES, SYSTEM_ROLES } from '../../types';

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email('Must be a valid email address'),
  role: z.enum(SYSTEM_ROLES).default('MEMBER'),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
