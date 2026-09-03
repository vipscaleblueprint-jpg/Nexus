"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = authenticateToken;
exports.requireSystemRole = requireSystemRole;
exports.requireJobRole = requireJobRole;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const redisService_1 = require("../services/redisService");
const JWT_SECRET = process.env.JWT_SECRET || 'nexus-default-jwt-secret-key-2026';
async function authenticateToken(req, res, next) {
    // Read token from HttpOnly cookie first, or fallback to Authorization header
    let token = req.cookies?.accessToken;
    if (!token) {
        const authHeader = req.headers['authorization'];
        token = authHeader && authHeader.split(' ')[1];
    }
    if (!token) {
        return res.status(401).json({ error: 'Authentication token required' });
    }
    // Check if token is blacklisted in Redis
    const blacklisted = await (0, redisService_1.isTokenBlacklisted)(token);
    if (blacklisted) {
        return res.status(401).json({ error: 'Token has been revoked' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded;
        req.token = token;
        next();
    }
    catch (error) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
}
// System Role Guard (e.g. ADMIN only)
function requireSystemRole(...allowedSystemRoles) {
    return (req, res, next) => {
        if (!req.user)
            return res.status(401).json({ error: 'Unauthorized' });
        if (!allowedSystemRoles.includes(req.user.systemRole)) {
            return res.status(403).json({
                error: `Requires system role: ${allowedSystemRoles.join(', ')}`,
            });
        }
        next();
    };
}
// Job Role Guard (e.g. PM, AUDITOR, CRM)
function requireJobRole(...allowedJobRoles) {
    return (req, res, next) => {
        if (!req.user)
            return res.status(401).json({ error: 'Unauthorized' });
        const userJobRoles = req.user.roles || [];
        const hasRole = allowedJobRoles.some((role) => userJobRoles.includes(role));
        if (!hasRole) {
            return res.status(403).json({
                error: `Requires job role permission: ${allowedJobRoles.join(', ')}`,
            });
        }
        next();
    };
}
