const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_SECRETE || 'CampusSecuritySuperSecretKey2026!#@';
const PORT = process.env.PORT || 5002;

const db = require('./dbconnect.js');
const UserModel = require('./user_schema.js');

// ----------------------------------------------------
// Health Check API
// ----------------------------------------------------
app.get('/health', (req, res) => {
    return res.status(200).json({
        service: 'Authentication Microservice',
        status: 'UP',
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

// ----------------------------------------------------
// LOGIN API (Handles /login and /api/auth/login)
// ----------------------------------------------------
const handleLogin = async (req, res) => {
    try {
        console.log('[Authentication Service] Login attempt for email:', req.body.email);

        const { email, password, role } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required for login."
            });
        }

        const cleanEmail = email.toLowerCase().trim();

        // Query user by email (and role if provided)
        const query = { email: cleanEmail };
        if (role) {
            query.role = role.toLowerCase().trim();
        }

        const user = await UserModel.findOne(query);

        // User not found with given credentials
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid email, password, or role"
            });
        }

        // Account suspended check
        if (user.isActive === false) {
            return res.status(403).json({
                success: false,
                message: "Account is deactivated or suspended. Please contact campus security administration."
            });
        }

        // Verify hashed password
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email, password, or role"
            });
        }

        // Generate signed JWT Token
        const tokenPayload = {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            department: user.department,
            cardId: user.cardId
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, {
            expiresIn: '24h'
        });

        console.log(`[Authentication Service] Successful login for: ${user.email} [${user.role}]`);

        return res.status(200).json({
            success: true,
            message: "Login successful",
            token: token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                department: user.department,
                cardId: user.cardId
            }
        });
    } catch (err) {
        console.error('[Authentication Service] Login error:', err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error during authentication."
        });
    }
};

app.post('/login', handleLogin);
app.post('/api/auth/login', handleLogin);

// ----------------------------------------------------
// TOKEN VERIFICATION API (Internal Gateway / Service check)
// ----------------------------------------------------
app.post('/api/auth/verify', (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = (authHeader && authHeader.split(' ')[1]) || req.body.token;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Token is required for verification."
            });
        }

        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) {
                return res.status(403).json({
                    success: false,
                    message: "Invalid or expired token",
                    error: err.message
                });
            }

            return res.status(200).json({
                success: true,
                valid: true,
                user: decoded
            });
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error verifying token."
        });
    }
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`[Authentication Service] Running on PORT: ${PORT}`);
});

module.exports = app;
