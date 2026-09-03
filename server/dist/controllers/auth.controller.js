"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signup = signup;
exports.login = login;
exports.googleAuth = googleAuth;
exports.googleCallback = googleCallback;
exports.refresh = refresh;
exports.logout = logout;
exports.getMe = getMe;
exports.updateProfile = updateProfile;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const redisService_1 = require("../services/redisService");
const prisma = new client_1.PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'nexus-default-jwt-secret-key-2026';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'nexus-default-jwt-refresh-secret-2026';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback';
const FRONTEND_URL = process.env.CORS_ORIGIN || 'http://localhost:3000';
const IS_PROD = process.env.NODE_ENV === 'production';
function setAuthCookies(res, accessToken, refreshToken, rememberMe = true) {
    // Access Token Cookie (1 day)
    res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: 'lax',
        maxAge: 24 * 3600 * 1000,
    });
    // Refresh Token Cookie (7 days if rememberMe, otherwise Session Cookie)
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: 'lax',
        ...(rememberMe ? { maxAge: 7 * 24 * 3600 * 1000 } : {}),
    });
}
function clearAuthCookies(res) {
    res.clearCookie('accessToken', { httpOnly: true, sameSite: 'lax' });
    res.clearCookie('refreshToken', { httpOnly: true, sameSite: 'lax' });
}
const signupSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
    name: zod_1.z.string().min(2),
    systemRole: zod_1.z.nativeEnum(client_1.SystemRole).optional(),
    primaryRole: zod_1.z.nativeEnum(client_1.RoleType).optional(),
    secondaryRole: zod_1.z.nativeEnum(client_1.RoleType).optional(),
    tertiaryRole: zod_1.z.nativeEnum(client_1.RoleType).optional(),
    minorRole: zod_1.z.nativeEnum(client_1.RoleType).optional(),
    employmentType: zod_1.z.nativeEnum(client_1.EmploymentType).optional(),
    dailySheetUrl: zod_1.z.string().url().optional(),
    starRating: zod_1.z.number().min(1).max(3).optional(),
    teamId: zod_1.z.string().optional(),
    rememberMe: zod_1.z.boolean().optional(),
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string(),
    rememberMe: zod_1.z.boolean().optional(),
});
function generateTokens(user) {
    const roles = [];
    if (user.primaryRole)
        roles.push(user.primaryRole);
    if (user.secondaryRole)
        roles.push(user.secondaryRole);
    if (user.tertiaryRole)
        roles.push(user.tertiaryRole);
    if (user.minorRole)
        roles.push(user.minorRole);
    const payload = {
        id: user.id,
        email: user.email,
        systemRole: user.systemRole,
        roles,
    };
    const accessToken = jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: '1d' });
    const refreshToken = jsonwebtoken_1.default.sign({ id: user.id }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
    return { accessToken, refreshToken, roles };
}
async function signup(req, res) {
    try {
        const data = signupSchema.parse(req.body);
        const rememberMe = data.rememberMe ?? true;
        const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
        if (existingUser) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }
        const hashedPassword = await bcryptjs_1.default.hash(data.password, 10);
        const user = await prisma.user.create({
            data: {
                email: data.email,
                password: hashedPassword,
                name: data.name,
                systemRole: data.systemRole || 'MEMBER',
                primaryRole: data.primaryRole,
                secondaryRole: data.secondaryRole,
                tertiaryRole: data.tertiaryRole,
                minorRole: data.minorRole,
                employmentType: data.employmentType || 'FULL_TIME',
                dailySheetUrl: data.dailySheetUrl,
                starRating: data.starRating || 1,
                teamId: data.teamId,
            },
            include: { team: true },
        });
        const { accessToken, refreshToken, roles } = generateTokens(user);
        await (0, redisService_1.storeRefreshToken)(user.id, refreshToken);
        // Set HttpOnly Cookies
        setAuthCookies(res, accessToken, refreshToken, rememberMe);
        return res.status(201).json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                systemRole: user.systemRole,
                primaryRole: user.primaryRole,
                secondaryRole: user.secondaryRole,
                tertiaryRole: user.tertiaryRole,
                minorRole: user.minorRole,
                roles,
                starRating: user.starRating,
                employmentType: user.employmentType,
                team: user.team,
            },
            rememberMe,
        });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError)
            return res.status(400).json({ error: err.errors });
        return res.status(500).json({ error: err.message || 'Signup failed' });
    }
}
async function login(req, res) {
    try {
        const { email, password, rememberMe = true } = loginSchema.parse(req.body);
        const user = await prisma.user.findUnique({
            where: { email },
            include: { team: true },
        });
        if (!user || !user.isActive) {
            return res.status(401).json({ error: 'Invalid credentials or inactive account' });
        }
        const isMatch = await bcryptjs_1.default.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });
        const { accessToken, refreshToken, roles } = generateTokens(user);
        await (0, redisService_1.storeRefreshToken)(user.id, refreshToken);
        // Set HttpOnly Cookies
        setAuthCookies(res, accessToken, refreshToken, rememberMe);
        return res.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatarUrl: user.avatarUrl,
                systemRole: user.systemRole,
                primaryRole: user.primaryRole,
                secondaryRole: user.secondaryRole,
                tertiaryRole: user.tertiaryRole,
                minorRole: user.minorRole,
                roles,
                starRating: user.starRating,
                employmentType: user.employmentType,
                dailySheetUrl: user.dailySheetUrl,
                team: user.team,
            },
            rememberMe,
        });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError)
            return res.status(400).json({ error: err.errors });
        return res.status(500).json({ error: err.message || 'Login failed' });
    }
}
// -----------------------------------------------------------------------------
// GOOGLE OAUTH FLOW
// -----------------------------------------------------------------------------
function googleAuth(req, res) {
    const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const options = {
        redirect_uri: GOOGLE_CALLBACK_URL,
        client_id: GOOGLE_CLIENT_ID,
        access_type: 'offline',
        response_type: 'code',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email',
        ].join(' '),
    };
    const qs = new URLSearchParams(options).toString();
    return res.redirect(`${rootUrl}?${qs}`);
}
async function googleCallback(req, res) {
    const code = req.query.code;
    if (!code) {
        return res.redirect(`${FRONTEND_URL}?error=Google%20auth%20code%20missing`);
    }
    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: GOOGLE_CALLBACK_URL,
                grant_type: 'authorization_code',
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) {
            throw new Error(tokenData.error_description || 'Failed to exchange Google code');
        }
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const googleUser = await userRes.json();
        let user = await prisma.user.findUnique({ where: { email: googleUser.email } });
        if (!user) {
            const randomPassword = await bcryptjs_1.default.hash(Math.random().toString(36), 10);
            user = await prisma.user.create({
                data: {
                    email: googleUser.email,
                    name: googleUser.name || googleUser.email.split('@')[0],
                    avatarUrl: googleUser.picture,
                    password: randomPassword,
                    systemRole: 'MEMBER',
                    employmentType: 'FULL_TIME',
                    starRating: 1,
                },
            });
        }
        else {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    lastLoginAt: new Date(),
                    avatarUrl: user.avatarUrl || googleUser.picture,
                },
            });
        }
        const { accessToken, refreshToken } = generateTokens(user);
        await (0, redisService_1.storeRefreshToken)(user.id, refreshToken);
        // Set HttpOnly Cookies
        setAuthCookies(res, accessToken, refreshToken, true);
        return res.redirect(FRONTEND_URL);
    }
    catch (err) {
        console.error('Google Callback Error:', err.message);
        return res.redirect(`${FRONTEND_URL}?error=${encodeURIComponent(err.message)}`);
    }
}
async function refresh(req, res) {
    try {
        const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token required' });
        }
        const decoded = jsonwebtoken_1.default.verify(refreshToken, JWT_REFRESH_SECRET);
        const storedToken = await (0, redisService_1.getRefreshToken)(decoded.id);
        if (!storedToken || storedToken !== refreshToken) {
            return res.status(403).json({ error: 'Invalid or revoked refresh token' });
        }
        const user = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (!user || !user.isActive) {
            return res.status(401).json({ error: 'User account disabled' });
        }
        const tokens = generateTokens(user);
        await (0, redisService_1.storeRefreshToken)(user.id, tokens.refreshToken);
        // Set updated HttpOnly Cookies
        setAuthCookies(res, tokens.accessToken, tokens.refreshToken, true);
        return res.json({ message: 'Token refreshed successfully' });
    }
    catch (err) {
        return res.status(403).json({ error: 'Invalid refresh token' });
    }
}
async function logout(req, res) {
    try {
        if (req.user) {
            await (0, redisService_1.removeRefreshToken)(req.user.id);
        }
        if (req.token) {
            await (0, redisService_1.blacklistToken)(req.token);
        }
        clearAuthCookies(res);
        return res.json({ message: 'Logged out successfully' });
    }
    catch (err) {
        clearAuthCookies(res);
        return res.status(500).json({ error: err.message });
    }
}
async function getMe(req, res) {
    try {
        if (!req.user)
            return res.status(401).json({ error: 'Unauthorized' });
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                email: true,
                name: true,
                avatarUrl: true,
                dailySheetUrl: true,
                starRating: true,
                employmentType: true,
                isActive: true,
                systemRole: true,
                primaryRole: true,
                secondaryRole: true,
                tertiaryRole: true,
                minorRole: true,
                lastLoginAt: true,
                createdAt: true,
                team: true,
            },
        });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        return res.json({ user });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
const updateProfileSchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    avatarUrl: zod_1.z.string().url().optional(),
    dailySheetUrl: zod_1.z.string().url().optional(),
    starRating: zod_1.z.number().min(1).max(3).optional(),
    employmentType: zod_1.z.nativeEnum(client_1.EmploymentType).optional(),
    systemRole: zod_1.z.nativeEnum(client_1.SystemRole).optional(),
    primaryRole: zod_1.z.nativeEnum(client_1.RoleType).nullable().optional(),
    secondaryRole: zod_1.z.nativeEnum(client_1.RoleType).nullable().optional(),
    tertiaryRole: zod_1.z.nativeEnum(client_1.RoleType).nullable().optional(),
    minorRole: zod_1.z.nativeEnum(client_1.RoleType).nullable().optional(),
    teamId: zod_1.z.string().nullable().optional(),
});
async function updateProfile(req, res) {
    try {
        if (!req.user)
            return res.status(401).json({ error: 'Unauthorized' });
        const data = updateProfileSchema.parse(req.body);
        const updatedUser = await prisma.user.update({
            where: { id: req.user.id },
            data,
            include: { team: true },
        });
        return res.json({ user: updatedUser });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError)
            return res.status(400).json({ error: err.errors });
        return res.status(500).json({ error: err.message });
    }
}
