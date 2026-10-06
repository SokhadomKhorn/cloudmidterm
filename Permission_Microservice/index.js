const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

const db = require('./dbconnect.js');
const PermissionModel = require('./permission_schema.js');

const PORT = process.env.PORT || 5004;

function generateId(prefix = 'PERM') {
    const rand = Math.floor(100 + Math.random() * 900);
    return `${prefix}-${Date.now().toString().slice(-4)}${rand}`;
}

// ----------------------------------------------------
// Health Check API
// ----------------------------------------------------
app.get('/health', (req, res) => {
    return res.status(200).json({
        service: 'Access Permission Microservice (Team Member 1)',
        status: 'UP',
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

// ----------------------------------------------------
// GRANT ROOM ACCESS PERMISSION (Admin)
// POST /api/permissions/grant
// ----------------------------------------------------
app.post('/api/permissions/grant', async (req, res) => {
    try {
        const {
            userId,
            userEmail,
            userRole = 'student',
            roomId,
            roomNumber,
            allowedDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            startTime = '08:00',
            endTime = '20:00',
            validUntil,
            grantedBy = 'admin'
        } = req.body;

        if (!userId || !userEmail || !roomId || !roomNumber) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields: userId, userEmail, roomId, and roomNumber are mandatory."
            });
        }

        const normalizedEmail = userEmail.toLowerCase().trim();
        const normalizedRoomNumber = roomNumber.toUpperCase().trim();

        // Check if an existing active permission already exists
        let permission = await PermissionModel.findOne({
            userEmail: normalizedEmail,
            roomNumber: normalizedRoomNumber,
            isActive: true
        });

        if (permission) {
            // Update existing permission
            permission.allowedDays = allowedDays;
            permission.startTime = startTime;
            permission.endTime = endTime;
            if (validUntil) permission.validUntil = new Date(validUntil);
            permission.grantedBy = grantedBy;
            await permission.save();

            console.log(`[Permission Service] Updated existing permission: ${normalizedEmail} -> ${normalizedRoomNumber}`);

            return res.status(200).json({
                success: true,
                message: "Existing room access permission updated successfully",
                permission
            });
        }

        // Create new permission
        permission = new PermissionModel({
            _id: generateId('PERM'),
            userId: userId.trim(),
            userEmail: normalizedEmail,
            userRole: userRole.toLowerCase().trim(),
            roomId: roomId.trim(),
            roomNumber: normalizedRoomNumber,
            allowedDays,
            startTime,
            endTime,
            validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            isActive: true,
            grantedBy
        });

        await permission.save();

        console.log(`[Permission Service] Granted access: ${normalizedEmail} -> ${normalizedRoomNumber} [${permission._id}]`);

        return res.status(201).json({
            success: true,
            message: `Access granted for user ${normalizedEmail} to room ${normalizedRoomNumber}`,
            permission
        });
    } catch (err) {
        console.error('[Permission Service] Grant error:', err);
        return res.status(500).json({
            success: false,
            message: err.message || "Error granting permission"
        });
    }
});

// ----------------------------------------------------
// VIEW ALL PERMISSIONS (Admin)
// GET /api/permissions
// ----------------------------------------------------
app.get('/api/permissions', async (req, res) => {
    try {
        const { userRole, roomNumber, isActive } = req.query;
        const filter = {};

        if (userRole) filter.userRole = userRole.toLowerCase();
        if (roomNumber) filter.roomNumber = roomNumber.toUpperCase();
        if (isActive !== undefined) filter.isActive = isActive === 'true';

        const permissions = await PermissionModel.find(filter).sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            totalPermissions: permissions.length,
            permissions
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error retrieving permissions"
        });
    }
});

// ----------------------------------------------------
// VIEW PERMISSIONS FOR A USER
// GET /api/permissions/user/:userId
// ----------------------------------------------------
app.get('/api/permissions/user/:userId', async (req, res) => {
    try {
        const param = req.params.userId;
        const permissions = await PermissionModel.find({
            $or: [{ userId: param }, { userEmail: param.toLowerCase() }],
            isActive: true
        });

        return res.status(200).json({
            success: true,
            totalPermissions: permissions.length,
            permissions
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error retrieving user permissions"
        });
    }
});

// ----------------------------------------------------
// VIEW AUTHORIZED USERS FOR A ROOM
// GET /api/permissions/room/:roomId
// ----------------------------------------------------
app.get('/api/permissions/room/:roomId', async (req, res) => {
    try {
        const param = req.params.roomId;
        const permissions = await PermissionModel.find({
            $or: [{ roomId: param }, { roomNumber: param.toUpperCase() }],
            isActive: true
        });

        return res.status(200).json({
            success: true,
            totalAuthorizedUsers: permissions.length,
            permissions
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error retrieving room permissions"
        });
    }
});

// ----------------------------------------------------
// EVALUATE / CHECK PERMISSION (Used by Access Log / Door Reader)
// POST /api/permissions/check
// ----------------------------------------------------
app.post('/api/permissions/check', async (req, res) => {
    try {
        const {
            userId,
            userEmail,
            userRole,
            roomId,
            roomNumber,
            timestamp
        } = req.body;

        // Admins always have master access override
        if (userRole === 'admin') {
            return res.status(200).json({
                allowed: true,
                reason: "ADMIN_OVERRIDE",
                message: "Master administrator access granted."
            });
        }

        const query = { isActive: true };
        if (userEmail) {
            query.userEmail = userEmail.toLowerCase().trim();
        } else if (userId) {
            query.userId = userId.trim();
        }

        if (roomNumber) {
            query.roomNumber = roomNumber.toUpperCase().trim();
        } else if (roomId) {
            query.roomId = roomId.trim();
        }

        const permission = await PermissionModel.findOne(query);

        if (!permission) {
            return res.status(200).json({
                allowed: false,
                reason: "NO_PERMISSION",
                message: "No active access permission found for this user in this room."
            });
        }

        const now = timestamp ? new Date(timestamp) : new Date();

        // 1. Check expiration date
        if (permission.validUntil && now > new Date(permission.validUntil)) {
            return res.status(200).json({
                allowed: false,
                reason: "PERMISSION_EXPIRED",
                message: `Access permission expired on ${permission.validUntil.toISOString()}.`
            });
        }

        // 2. Check Day of Week
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const currentDay = days[now.getDay()];

        if (Array.isArray(permission.allowedDays) && permission.allowedDays.length > 0) {
            const dayMatch = permission.allowedDays.some(d => d.toLowerCase() === currentDay.toLowerCase());
            if (!dayMatch) {
                return res.status(200).json({
                    allowed: false,
                    reason: "OUTSIDE_ALLOWED_DAYS",
                    message: `Room access not allowed on ${currentDay}. Allowed days: ${permission.allowedDays.join(', ')}.`
                });
            }
        }

        // 3. Check Time Window (HH:mm)
        const currentHour = now.getHours().toString().padStart(2, '0');
        const currentMin = now.getMinutes().toString().padStart(2, '0');
        const currentTimeStr = `${currentHour}:${currentMin}`;

        if (permission.startTime && permission.endTime) {
            if (currentTimeStr < permission.startTime || currentTimeStr > permission.endTime) {
                return res.status(200).json({
                    allowed: false,
                    reason: "OUTSIDE_SCHEDULED_HOURS",
                    message: `Access denied. Permitted schedule is between ${permission.startTime} and ${permission.endTime}. Current time: ${currentTimeStr}.`
                });
            }
        }

        return res.status(200).json({
            allowed: true,
            reason: "AUTHORIZED",
            message: "User is authorized for room access.",
            permissionId: permission._id
        });
    } catch (err) {
        console.error('[Permission Service] Check error:', err);
        return res.status(500).json({
            allowed: false,
            reason: "EVALUATION_ERROR",
            message: err.message
        });
    }
});

// ----------------------------------------------------
// REVOKE / DELETE PERMISSION (Admin)
// DELETE /api/permissions/:id
// ----------------------------------------------------
app.delete('/api/permissions/:id', async (req, res) => {
    try {
        const deleted = await PermissionModel.findByIdAndDelete(req.params.id);
        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: "Permission record not found to delete."
            });
        }

        console.log(`[Permission Service] Revoked permission: ${deleted._id} (${deleted.userEmail} -> ${deleted.roomNumber})`);

        return res.status(200).json({
            success: true,
            message: `Permission ${deleted._id} revoked successfully for ${deleted.userEmail}.`
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error revoking permission"
        });
    }
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`[Permission Service] Running on PORT: ${PORT}`);
});

module.exports = app;
