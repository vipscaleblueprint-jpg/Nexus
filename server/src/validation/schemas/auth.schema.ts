import { z } from 'zod';
import { httpUrl, shortText } from './common';

const email = z.string().trim().toLowerCase().email('must be a valid email address');
const password = z.string().min(6, 'password must be at least 6 characters').max(128);

// Only what a self-registering user may choose. Role, job roles, team, rating and employment type are set by an
// admin or the VIPScale sync; accepting them here let anyone sign up straight into ADMIN.
export const signupSchema = z.object({
  email,
  password,
  name: shortText('name').min(2, 'name must be at least 2 characters'),
  rememberMe: z.boolean().optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'password is required'),
  rememberMe: z.boolean().optional(),
});

export const notificationPreferencesSchema = z.object({
  status: z.boolean().optional(),
  checklists: z.boolean().optional(),
  audits: z.boolean().optional(),
  assigned: z.boolean().optional(),
  comments: z.boolean().optional(),
  mentions: z.boolean().optional(),
  defaultView: z.enum(['for_me', 'show_all']).optional(),
  confettiEnabled: z.boolean().optional(),
  receiveConfetti: z.boolean().optional(),
});

export const updateProfileSchema = z.object({
  name: shortText('name').min(2).optional(),
  avatarUrl: httpUrl.optional(),
  dailySheetUrl: httpUrl.optional(),
  notificationPreferences: notificationPreferencesSchema.optional(),
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
