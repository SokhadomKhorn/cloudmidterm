const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

const db = require('./dbconnect.js');
const AccessLogModel = require('./access_log_schema.js');

const PORT = process.env.PORT || 5005;
const INSTANCE_NAME = process.env.INSTANCE_NAME || `AccessLog-Instance-${PORT}`;

function generateId(prefix = 'SWIPE') {
    const rand = Math.floor(100 + Math.random() * 900);
    return `${prefix}-${Date.now().toString().slice(-4)}${rand}`;
}

// Middleware to inject Load Balancing identification headers
app.use((req, res, next) => {
    res.setHeader('X-Served-By-Instance', INSTANCE_NAME);
    res.setHeader('X-Served-By-Port', PORT.toString());
    next();
});

// ----------------------------------------------------
// Health Check API (Reports instance identity for load balancing verification)
// ----------------------------------------------------
app.get('/health', (req, res) => {
    return res.status(200).json({
        service: 'Access Log & Swipe Microservice (Team Member 2)',
        instanceName: INSTANCE_NAME,
        status: 'UP',
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

// ----------------------------------------------------
// PROCESS DOOR SWIPE / BADGE SCAN API
// POST /api/logs/swipe
// ----------------------------------------------------
app.post('/api/logs/swipe', async (req, res) => {
    try {
        console.log(`[${INSTANCE_NAME}] Swipe request received:`, req.body);

        const {
            userId,
            userEmail,
            userRole = 'student',
            roomId,
            roomNumber,
            building = 'Main Campus',
            cardId
        } = req.body;

        if ((!userId && !userEmail) || (!roomId && !roomNumber)) {
            return res.status(400).json({
                success: false,
                message: "Missing required identifiers: user (userId or userEmail) and room (roomId or roomNumber) are required."
            });
        }

        const normalizedEmail = (userEmail || '').toLowerCase().trim();
        const normalizedRoomNumber = (roomNumber || '').toUpperCase().trim();
        const cleanUserId = userId || normalizedEmail;
        const cleanRoomId = roomId || normalizedRoomNumber;

        let status = 'GRANTED';
        let denialReason = null;

        // 1. Check Room status directly from database
        try {
            const room = await db.connection.collection('rooms').findOne({
                $or: [{ roomNumber: normalizedRoomNumber }, { _id: cleanRoomId }]
            });

            if (room) {
                if (room.isEmergencyLocked) {
                    status = 'DENIED';
                    denialReason = 'CAMPUS_EMERGENCY_LOCKDOWN';
                } else if (room.isLocked) {
                    status = 'DENIED';
                    denialReason = 'ROOM_PHYSICALLY_LOCKED';
                }
            }
        } catch (dbErr) {
            console.warn(`[${INSTANCE_NAME}] Warning reading rooms collection:`, dbErr.message);
        }

        // 2. If not already denied, check User Permissions
        if (status === 'GRANTED') {
            if (userRole === 'admin') {
                // Admins have master access override
                status = 'GRANTED';
                denialReason = null;
            } else {
                try {
                    const permission = await db.connection.collection('access_permissions').findOne({
                        $or: [
                            { userEmail: normalizedEmail, roomNumber: normalizedRoomNumber },
                            { userId: cleanUserId, roomId: cleanRoomId },
                            { userEmail: normalizedEmail, roomId: cleanRoomId }
                        ],
                        isActive: true
                    });

                    if (!permission) {
                        status = 'DENIED';
                        denialReason = 'NO_PERMISSION_GRANTED';
                    } else {
                        const now = new Date();

                        // Check Expiration
                        if (permission.validUntil && now > new Date(permission.validUntil)) {
                            status = 'DENIED';
                            denialReason = 'PERMISSION_EXPIRED';
                        } else {
                            // Check Day of Week
                            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                            const currentDay = days[now.getDay()];

                            if (Array.isArray(permission.allowedDays) && permission.allowedDays.length > 0) {
                                const dayMatch = permission.allowedDays.some(d => d.toLowerCase() === currentDay.toLowerCase());
                                if (!dayMatch) {
                                    status = 'DENIED';
                                    denialReason = `OUTSIDE_ALLOWED_DAYS_${currentDay.toUpperCase()}`;
                                }
                            }

                            // Check Time Range
                            if (status === 'GRANTED' && permission.startTime && permission.endTime) {
                                const currentHour = now.getHours().toString().padStart(2, '0');
                                const currentMin = now.getMinutes().toString().padStart(2, '0');
                                const currentTimeStr = `${currentHour}:${currentMin}`;

                                if (currentTimeStr < permission.startTime || currentTimeStr > permission.endTime) {
                                    status = 'DENIED';
                                    denialReason = `OUTSIDE_SCHEDULED_HOURS_${currentTimeStr}`;
                                }
                            }
                        }
                    }
                } catch (permErr) {
                    console.warn(`[${INSTANCE_NAME}] Warning checking permissions:`, permErr.message);
                    status = 'DENIED';
                    denialReason = 'PERMISSION_CHECK_ERROR';
                }
            }
        }

        // 3. Save Access Log Entry
        const logEntry = new AccessLogModel({
            _id: generateId('SWIPE'),
            userId: cleanUserId,
            userEmail: normalizedEmail,
            userRole: userRole.toLowerCase().trim(),
            roomId: cleanRoomId,
            roomNumber: normalizedRoomNumber,
            building: building,
            status: status,
            denialReason: denialReason,
            servedByInstance: INSTANCE_NAME,
            swipeTimestamp: new Date()
        });

        await logEntry.save();

        console.log(`[${INSTANCE_NAME}] Swipe Logged: ${logEntry._id} -> [${status}] (${denialReason || 'OK'}) by ${normalizedEmail}`);

        return res.status(200).json({
            success: true,
            accessDecision: status,
            doorUnlocked: status === 'GRANTED',
            message: status === 'GRANTED' ? "Door unlocked. Access granted." : `Access denied: ${denialReason}`,
            log: {
                id: logEntry._id,
                userEmail: logEntry.userEmail,
                roomNumber: logEntry.roomNumber,
                status: logEntry.status,
                denialReason: logEntry.denialReason,
                timestamp: logEntry.swipeTimestamp,
                servedBy: INSTANCE_NAME
            }
        });
    } catch (err) {
        console.error(`[${INSTANCE_NAME}] Swipe processing error:`, err);
        return res.status(500).json({
            success: false,
            message: err.message || "Error processing swipe"
        });
    }
});

// ----------------------------------------------------
// QUERY ALL ACCESS LOGS (Admin Audit)
// GET /api/logs?status=...&roomNumber=...&userEmail=...&limit=...
// ----------------------------------------------------
app.get('/api/logs', async (req, res) => {
    try {
        const { status, roomNumber, userEmail, userRole, limit = 100 } = req.query;
        const filter = {};

        if (status) filter.status = status.toUpperCase();
        if (roomNumber) filter.roomNumber = roomNumber.toUpperCase();
        if (userEmail) filter.userEmail = userEmail.toLowerCase();
        if (userRole) filter.userRole = userRole.toLowerCase();

        const logs = await AccessLogModel.find(filter)
            .sort({ swipeTimestamp: -1 })
            .limit(Number(limit));

        return res.status(200).json({
            success: true,
            totalLogs: logs.length,
            servedBy: INSTANCE_NAME,
            logs
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error retrieving logs"
        });
    }
});

// ----------------------------------------------------
// QUERY LOGS FOR A SPECIFIC USER (Own History / Admin)
// GET /api/logs/user/:userId
// ----------------------------------------------------
app.get('/api/logs/user/:userId', async (req, res) => {
    try {
        const param = req.params.userId;
        const logs = await AccessLogModel.find({
            $or: [{ userId: param }, { userEmail: param.toLowerCase() }]
        })
        .sort({ swipeTimestamp: -1 })
        .limit(50);

        return res.status(200).json({
            success: true,
            totalEntries: logs.length,
            servedBy: INSTANCE_NAME,
            logs
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error retrieving user logs"
        });
    }
});

// ----------------------------------------------------
// SECURITY AUDIT SUMMARY STATISTICS (Admin Dashboard)
// GET /api/logs/stats/summary
// ----------------------------------------------------
app.get('/api/logs/stats/summary', async (req, res) => {
    try {
        const totalSwipes = await AccessLogModel.countDocuments();
        const totalGranted = await AccessLogModel.countDocuments({ status: 'GRANTED' });
        const totalDenied = await AccessLogModel.countDocuments({ status: 'DENIED' });

        const denialBreakdown = await AccessLogModel.aggregate([
            { $match: { status: 'DENIED' } },
            { $group: { _id: '$denialReason', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        const mostAccessedRooms = await AccessLogModel.aggregate([
            { $group: { _id: '$roomNumber', count: { $sum: 1 }, granted: { $sum: { $cond: [{ $eq: ['$status', 'GRANTED'] }, 1, 0] } } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        return res.status(200).json({
            success: true,
            servedBy: INSTANCE_NAME,
            statistics: {
                totalSwipes,
                totalGranted,
                totalDenied,
                approvalRate: totalSwipes > 0 ? `${((totalGranted / totalSwipes) * 100).toFixed(1)}%` : '0%',
                denialRate: totalSwipes > 0 ? `${((totalDenied / totalSwipes) * 100).toFixed(1)}%` : '0%',
                denialBreakdown,
                mostAccessedRooms
            }
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error calculating statistics"
        });
    }
});

// ----------------------------------------------------
// ARCHIVE / CLEANUP LOGS (Admin)
// DELETE /api/logs/cleanup
// ----------------------------------------------------
app.delete('/api/logs/cleanup', async (req, res) => {
    try {
        const { olderThanDays = 90 } = req.body;
        const cutoffDate = new Date(Date.now() - Number(olderThanDays) * 24 * 60 * 60 * 1000);

        const result = await AccessLogModel.deleteMany({
            swipeTimestamp: { $lt: cutoffDate }
        });

        return res.status(200).json({
            success: true,
            message: `Cleaned up ${result.deletedCount} log records older than ${olderThanDays} days.`,
            deletedCount: result.deletedCount
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error cleaning up logs"
        });
    }
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`[${INSTANCE_NAME}] Running on PORT: ${PORT}`);
});

module.exports = app;
