const express = require('express');
const httpProxy = require('http-proxy');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const RoundRobinLoadBalancer = require('./load-balancer.js');

const app = express();
const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    xfwd: true
});

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_SECRETE || 'CampusSecuritySuperSecretKey2026!#@';

// Upstream Target URLs
const REG_SERVICE_URL = process.env.REGISTRATION_SERVICE_URL || 'http://localhost:5001';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5002';
const ROOM_SERVICE_URL = process.env.ROOM_SERVICE_URL || 'http://localhost:5003';
const PERM_SERVICE_URL = process.env.PERMISSION_SERVICE_URL || 'http://localhost:5004';
const EMERGENCY_SERVICE_URL = process.env.EMERGENCY_SERVICE_URL || 'http://localhost:5006';

// Initialize Load Balancer for high-concurrency Access Log & Door Swipe Service
const accessLogLoadBalancer = new RoundRobinLoadBalancer('AccessLogService', [
    { url: process.env.ACCESS_LOG_INSTANCE_1 || 'http://localhost:5005', name: 'AccessLog-Instance-1', port: 5005 },
    { url: process.env.ACCESS_LOG_INSTANCE_2 || 'http://localhost:5015', name: 'AccessLog-Instance-2', port: 5015 }
]);

// Enable Cross-Origin Resource Sharing
app.use(cors());

// Request Logging Middleware
app.use((req, res, next) => {
    console.log(`[API Gateway] ${new Date().toISOString()} | ${req.method} ${req.originalUrl}`);
    next();
});

// Proxy Error Handling
proxy.on('error', (err, req, res) => {
    console.error('[API Gateway] Proxy Error:', err.message);
    if (!res.headersSent) {
        res.status(502).json({
            success: false,
            error: "Bad Gateway",
            message: "Target microservice is unavailable or unreachable.",
            details: err.message
        });
    }
});

// Helper: Forward request to upstream microservice with identity headers
function forward(req, res, targetUrl, extraHeaders = {}) {
    req.url = req.originalUrl;

    if (req.user) {
        req.headers['x-user-id'] = req.user.id || '';
        req.headers['x-user-email'] = req.user.email || '';
        req.headers['x-user-role'] = req.user.role || '';
        req.headers['x-user-department'] = req.user.department || '';
    }

    Object.keys(extraHeaders).forEach(k => {
        res.setHeader(k, extraHeaders[k]);
    });

    proxy.web(req, res, { target: targetUrl });
}

// ====================================================================
// AUTHENTICATION & RBAC MIDDLEWARES
// ====================================================================

/**
 * Verify JWT Bearer Token Middleware
 */
function authToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized",
            message: "Please send token. Bearer token is required in Authorization header."
        });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        return res.status(401).json({
            success: false,
            error: "Unauthorized",
            message: "Invalid token format. Expected: 'Bearer <token>'"
        });
    }

    const token = parts[1];

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({
                success: false,
                error: "Forbidden",
                message: "Invalid or expired token.",
                details: err.message
            });
        }

        req.user = decoded;
        next();
    });
}

/**
 * Role-Based Access Control (RBAC) Authorization Middleware
 * @param {string|string[]} roles Allowed role or array of roles
 */
function authRole(roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(403).json({
                success: false,
                error: "Forbidden",
                message: "User role information is missing from token."
            });
        }

        const userRole = req.user.role.toLowerCase();
        const hasAccess = allowed.map(r => r.toLowerCase()).includes(userRole);

        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: "Unauthorized",
                message: `Access denied. Role '${req.user.role}' is unauthorized for this endpoint. Required role(s): [${allowed.join(', ')}]`
            });
        }

        next();
    };
}

// ====================================================================
// GATEWAY UTILITY ENDPOINTS
// ====================================================================

// Health Check API
app.get('/health', (req, res) => {
    return res.status(200).json({
        service: 'API Gateway Microservice',
        status: 'UP',
        port: PORT,
        upstreamServices: {
            registration: REG_SERVICE_URL,
            authentication: AUTH_SERVICE_URL,
            roomManagement: ROOM_SERVICE_URL,
            accessPermission: PERM_SERVICE_URL,
            emergencyAlert: EMERGENCY_SERVICE_URL,
            accessLogLoadBalancedPool: accessLogLoadBalancer.instances.map(i => ({ name: i.name, url: i.url }))
        },
        timestamp: new Date().toISOString()
    });
});

// Load Balancer Live Statistics API
app.get('/api/gateway/load-balancer-stats', authToken, authRole(['admin']), (req, res) => {
    return res.status(200).json({
        success: true,
        stats: accessLogLoadBalancer.getStats()
    });
});

// ====================================================================
// PUBLIC AUTHENTICATION & REGISTRATION ROUTES
// ====================================================================

// 1. Registration Service (Redirect /reg and /api/auth/register)
app.use(['/reg', '/api/auth/register'], (req, res) => {
    forward(req, res, REG_SERVICE_URL);
});

// 2. Authentication Service (Redirect /login, /api/auth/login, /api/auth/verify)
app.use(['/login', '/api/auth/login', '/api/auth/verify'], (req, res) => {
    forward(req, res, AUTH_SERVICE_URL);
});

// ====================================================================
// MEMBER 1 MICROSERVICES: ROOM & PERMISSION MANAGEMENT
// ====================================================================

// Room Management Routes
// Write (POST, PUT, DELETE) -> Admin only
// Lock Toggle (PATCH) -> Admin, Faculty
// Read (GET) -> Admin, Faculty, Student
app.use('/api/rooms', authToken, (req, res, next) => {
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        return authRole(['admin'])(req, res, () => forward(req, res, ROOM_SERVICE_URL));
    }
    if (req.method === 'PATCH') {
        return authRole(['admin', 'faculty'])(req, res, () => forward(req, res, ROOM_SERVICE_URL));
    }
    // GET requests
    return authRole(['admin', 'faculty', 'student'])(req, res, () => forward(req, res, ROOM_SERVICE_URL));
});

// Access Permission Routes
// Grant, Revoke, Room Query -> Admin only
// User Permissions Query, Permission Check -> Admin, Faculty, Student
app.use('/api/permissions', authToken, (req, res, next) => {
    if (req.method === 'POST' && req.path.includes('/check')) {
        return authRole(['admin', 'faculty', 'student'])(req, res, () => forward(req, res, PERM_SERVICE_URL));
    }
    if (req.method === 'POST' || req.method === 'DELETE' || req.path.includes('/room/')) {
        return authRole(['admin'])(req, res, () => forward(req, res, PERM_SERVICE_URL));
    }
    // GET /user/:id or general queries
    return authRole(['admin', 'faculty', 'student'])(req, res, () => forward(req, res, PERM_SERVICE_URL));
});

// ====================================================================
// MEMBER 2 MICROSERVICES: ACCESS LOG (LOAD BALANCED) & EMERGENCY ALERT
// ====================================================================

// Door Swipe & Access Audit Log Routes (LOAD BALANCED across multiple instances)
// POST /swipe -> Admin, Faculty, Student (badge swipes)
// GET /user/:id -> Admin, Faculty, Student (view own logs)
// GET / (all logs), GET /stats/summary, DELETE /cleanup -> Admin only
app.use('/api/logs', authToken, (req, res, next) => {
    const handleLoadBalancedRoute = () => {
        // Select upstream instance via Round-Robin Load Balancer
        const target = accessLogLoadBalancer.getNextTarget();
        forward(req, res, target.url, {
            'X-Load-Balanced-By': 'API-Gateway-RoundRobin',
            'X-Upstream-Target': target.url,
            'X-Served-By-Instance': target.name,
            'X-Served-By-Port': target.port.toString()
        });
    };

    if (req.method === 'POST' && req.path.includes('/swipe')) {
        return authRole(['admin', 'faculty', 'student'])(req, res, handleLoadBalancedRoute);
    }
    if (req.method === 'GET' && req.path.includes('/user/')) {
        return authRole(['admin', 'faculty', 'student'])(req, res, handleLoadBalancedRoute);
    }
    // Admin only for viewing full audit logs, statistics, or cleaning up
    return authRole(['admin'])(req, res, handleLoadBalancedRoute);
});

// Emergency Alert & Security Lockdown Routes
// POST /lockdown, POST /lift, GET /history, DELETE -> Admin only
// GET /active, POST /report -> Admin, Faculty, Student
app.use('/api/alerts', authToken, (req, res, next) => {
    if (req.method === 'POST' && req.path.includes('/report')) {
        return authRole(['admin', 'faculty', 'student'])(req, res, () => forward(req, res, EMERGENCY_SERVICE_URL));
    }
    if (req.method === 'GET' && req.path.includes('/active')) {
        return authRole(['admin', 'faculty', 'student'])(req, res, () => forward(req, res, EMERGENCY_SERVICE_URL));
    }
    // Admin only for lockdown activation, lifting lockdown, or full history
    return authRole(['admin'])(req, res, () => forward(req, res, EMERGENCY_SERVICE_URL));
});

// ====================================================================
// ADMIN DIRECT USER MANAGEMENT ROUTES (Redirect to Registration Service)
// ====================================================================
app.use('/admin', authToken, authRole(['admin']), (req, res) => {
    console.log("[API Gateway] Routing to Admin User Management API in Registration Service");
    forward(req, res, REG_SERVICE_URL);
});

app.use('/api/admin', authToken, authRole(['admin']), (req, res) => {
    forward(req, res, REG_SERVICE_URL);
});

// 404 Catch-All
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: "Not Found",
        message: `Endpoint ${req.method} ${req.originalUrl} does not exist on API Gateway.`
    });
});

// Start API Gateway Express Server
app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`API Gateway Service is running on PORT: ${PORT}`);
    console.log(`Load Balancer active for Access Log pool:`);
    accessLogLoadBalancer.instances.forEach((inst, idx) => {
        console.log(`  [Instance ${idx + 1}] ${inst.name} -> ${inst.url}`);
    });
    console.log(`=======================================================`);
});

module.exports = app;
