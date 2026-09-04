import { Router } from 'express';
import {
  signup,
  login,
  refresh,
  logout,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  googleAuth,
  googleCallback,
} from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { validateBody } from '../validation';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  updateProfileSchema,
} from '../validation/schemas';

export const authRouter = Router();

// Public Routes
authRouter.post('/signup', validateBody(signupSchema), signup);
authRouter.post('/login', validateBody(loginSchema), login);
authRouter.post('/refresh', refresh);
authRouter.post('/forgot-password', validateBody(forgotPasswordSchema), forgotPassword);
authRouter.post('/reset-password', validateBody(resetPasswordSchema), resetPassword);

// Google OAuth Routes
authRouter.get('/google', googleAuth);
authRouter.get('/google/callback', googleCallback);

// Authenticated Routes
authRouter.post('/logout', authenticateToken, logout);
authRouter.get('/me', authenticateToken, getMe);
authRouter.patch('/me', authenticateToken, validateBody(updateProfileSchema), updateProfile);
authRouter.post('/change-password', authenticateToken, validateBody(changePasswordSchema), changePassword);
