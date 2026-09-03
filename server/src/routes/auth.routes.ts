import { Router } from 'express';
import {
  signup,
  login,
  refresh,
  logout,
  getMe,
  updateProfile,
  googleAuth,
  googleCallback,
} from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';

export const authRouter = Router();

// Public Routes
authRouter.post('/signup', signup);
authRouter.post('/login', login);
authRouter.post('/refresh', refresh);

// Google OAuth Routes
authRouter.get('/google', googleAuth);
authRouter.get('/google/callback', googleCallback);

// Authenticated Routes
authRouter.post('/logout', authenticateToken, logout);
authRouter.get('/me', authenticateToken, getMe);
authRouter.patch('/me', authenticateToken, updateProfile);
