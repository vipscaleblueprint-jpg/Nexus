"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
exports.authRouter = (0, express_1.Router)();
// Public Routes
exports.authRouter.post('/signup', auth_controller_1.signup);
exports.authRouter.post('/login', auth_controller_1.login);
exports.authRouter.post('/refresh', auth_controller_1.refresh);
// Google OAuth Routes
exports.authRouter.get('/google', auth_controller_1.googleAuth);
exports.authRouter.get('/google/callback', auth_controller_1.googleCallback);
// Authenticated Routes
exports.authRouter.post('/logout', auth_middleware_1.authenticateToken, auth_controller_1.logout);
exports.authRouter.get('/me', auth_middleware_1.authenticateToken, auth_controller_1.getMe);
exports.authRouter.patch('/me', auth_middleware_1.authenticateToken, auth_controller_1.updateProfile);
