const express = require('express');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(express.json());

const db = require('./dbconnect.js');
const UserModel = require('./user_schema.js');

const PORT = process.env.PORT || 5001;

function generateId(prefix = 'USR') {
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${Date.now().toString().slice(-4)}${rand}`;
}

// ----------------------------------------------------
// Health Check API
// ----------------------------------------------------
app.get('/health', (req, res) => {
    return res.status(200).json({
        service: 'Registration Microservice',
        status: 'UP',
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

// ----------------------------------------------------
// USER REGISTRATION API (Handles /reg and /api/auth/register)
// ----------------------------------------------------
const handleRegistration = async (req, res) => {
    try {
        console.log('[Registration Service] Registration request received:', req.body.email);

        const {
            name,
            firstname,
            email,
            password,
            role = 'student',
            department = 'General Studies',
            mobile,
            phone,
            cardId
        } = req.body;

        const fullName = name || firstname;
        const contactPhone = phone || mobile || '';

        // 1. Validate required fields
        if (!fullName || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields: 'name' (or 'firstname'), 'email', and 'password' are required."
            });
        }

        // 2. Validate allowed roles
        const normalizedRole = role.toLowerCase().trim();
        const allowedRoles = ['admin', 'faculty', 'student'];
        if (!allowedRoles.includes(normalizedRole)) {
            return res.status(400).json({
                success: false,
                message: `Invalid role '${role}'. Allowed roles are: ${allowedRoles.join(', ')}`
            });
        }

        // 3. Check for existing user with same email
        const existingUser = await UserModel.findOne({ email: email.toLowerCase().trim() });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "Email is already registered. Please login or use a different email."
            });
        }

        // 4. Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 5. Generate Card / RFID ID if not provided
        const assignedCardId = cardId || `CARD-${Math.floor(100000 + Math.random() * 900000)}`;
        const userId = generateId('USR');

        // 6. Create user entity
        const newUser = new UserModel({
            _id: userId,
            name: fullName,
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: normalizedRole,
            department: department,
            phone: contactPhone,
            cardId: assignedCardId,
            isActive: true
        });

        await newUser.save();

        console.log(`[Registration Service] User created: ${newUser.email} [${newUser.role}] ID: ${newUser._id}`);

        return res.status(201).json({
            success: true,
            message: "User registered successfully",
            user: {
                id: newUser._id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
                department: newUser.department,
                phone: newUser.phone,
                cardId: newUser.cardId,
                createdAt: newUser.createdAt
            }
        });
    } catch (err) {
        console.error('[Registration Service] Registration error:', err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error during registration."
        });
    }
};

app.post('/reg', handleRegistration);
app.post('/api/auth/register', handleRegistration);

// ----------------------------------------------------
// BATCH REGISTRATION API (Admin bulk student/faculty import)
// ----------------------------------------------------
app.post('/api/auth/batch-register', async (req, res) => {
    try {
        const { users } = req.body;
        if (!Array.isArray(users) || users.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please provide an array of users under 'users' key."
            });
        }

        const results = [];
        const saltRounds = 10;

        for (const u of users) {
            try {
                const existing = await UserModel.findOne({ email: u.email.toLowerCase().trim() });
                if (existing) {
                    results.push({ email: u.email, status: 'SKIPPED', reason: 'Email already exists' });
                    continue;
                }

                const hashedPassword = await bcrypt.hash(u.password || 'CampusDefaultPass123!', saltRounds);
                const newUser = new UserModel({
                    _id: generateId('USR'),
                    name: u.name || u.firstname,
                    email: u.email.toLowerCase().trim(),
                    password: hashedPassword,
                    role: (u.role || 'student').toLowerCase().trim(),
                    department: u.department || 'General Studies',
                    phone: u.phone || u.mobile || '',
                    cardId: u.cardId || `CARD-${Math.floor(100000 + Math.random() * 900000)}`,
                    isActive: true
                });

                await newUser.save();
                results.push({ email: newUser.email, status: 'CREATED', id: newUser._id, cardId: newUser.cardId });
            } catch (userErr) {
                results.push({ email: u.email, status: 'FAILED', error: userErr.message });
            }
        }

        return res.status(201).json({
            success: true,
            message: `Batch registration completed. Processed ${results.length} records.`,
            results
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error processing batch registration."
        });
    }
});

// ----------------------------------------------------
// VIEW ALL USERS API (Internal / Admin)
// ----------------------------------------------------
app.get('/users', async (req, res) => {
    try {
        const { role, department } = req.query;
        const filter = {};
        if (role) filter.role = role.toLowerCase();
        if (department) filter.department = new RegExp(department, 'i');

        const users = await UserModel.find(filter).select('-password');
        return res.status(200).json({
            success: true,
            totalUsers: users.length,
            users
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ----------------------------------------------------
// GET USER BY ID OR CARD ID
// ----------------------------------------------------
app.get('/users/:id', async (req, res) => {
    try {
        const user = await UserModel.findById(req.params.id).select('-password');
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        return res.status(200).json({ success: true, user });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/users/card/:cardId', async (req, res) => {
    try {
        const user = await UserModel.findOne({ cardId: req.params.cardId }).select('-password');
        if (!user) {
            return res.status(404).json({ success: false, message: "Card ID not found" });
        }
        return res.status(200).json({ success: true, user });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ----------------------------------------------------
// DELETE USER BY EMAIL (Admin Cleanup)
// ----------------------------------------------------
app.delete('/users/:email', async (req, res) => {
    try {
        const deleted = await UserModel.findOneAndDelete({ email: req.params.email.toLowerCase().trim() });
        if (!deleted) {
            return res.status(404).json({ success: false, message: "User not found to delete" });
        }
        return res.status(200).json({ success: true, message: `User ${deleted.email} deleted successfully.` });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`[Registration Service] Running on PORT: ${PORT}`);
});

module.exports = app;
