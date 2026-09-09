import { z } from 'zod';
import { EMPLOYMENT_TYPES, SYSTEM_ROLES } from '../../types';
import { httpUrl, shortText, uuid } from './common';

const email = z.string().trim().toLowerCase().email('must be a valid email address');
const password = z.string().min(6, 'password must be at least 6 characters').max(128);

export const signupSchema = z.object({
  email,
  password,
  name: shortText('name').min(2, 'name must be at least 2 characters'),
  systemRole: z.enum(SYSTEM_ROLES).optional(),
  primaryRole: z.string().optional().nullable(),
  secondaryRole: z.string().optional().nullable(),
  tertiaryRole: z.string().optional().nullable(),
  minorRole: z.string().optional().nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  dailySheetUrl: httpUrl.optional(),
  starRating: z.number().int().min(1).max(3).optional(),
  teamId: uuid.optional(),
  rememberMe: z.boolean().optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'password is required'),
  rememberMe: z.boolean().optional(),
});

export const updateProfileSchema = z.object({
  name: shortText('name').min(2).optional(),
  avatarUrl: httpUrl.optional(),
  dailySheetUrl: httpUrl.optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: password,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  email,
  otp: z.string().trim().regex(/^\d{6}$/, 'otp must be 6 digits'),
  newPassword: password,
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
