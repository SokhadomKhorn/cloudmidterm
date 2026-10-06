const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

const db = require('./dbconnect.js');
const AlertModel = require('./alert_schema.js');

const PORT = process.env.PORT || 5006;

function generateId(prefix = 'ALERT') {
    const rand = Math.floor(100 + Math.random() * 900);
    return `${prefix}-${Date.now().toString().slice(-4)}${rand}`;
}

// ----------------------------------------------------
// Health Check API
// ----------------------------------------------------
app.get('/health', (req, res) => {
    return res.status(200).json({
        service: 'Emergency Alert & Security Microservice (Team Member 2)',
        status: 'UP',
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

// ----------------------------------------------------
// TRIGGER EMERGENCY LOCKDOWN (Admin)
// POST /api/alerts/lockdown
// ----------------------------------------------------
app.post('/api/alerts/lockdown', async (req, res) => {
    try {
        const {
            building = 'ALL',
            description = 'Campus security lockdown activated',
            severity = 'CRITICAL',
            triggeredBy = 'SECURITY_ADMIN'
        } = req.body;

        const alertId = generateId('ALERT');
        const newAlert = new AlertModel({
            _id: alertId,
            alertType: building === 'ALL' ? 'CAMPUS_LOCKDOWN' : 'BUILDING_LOCKDOWN',
            building: building.trim(),
            description: description.trim(),
            severity: severity.toUpperCase().trim(),
            triggeredBy: triggeredBy.trim(),
            status: 'ACTIVE'
        });

        await newAlert.save();

        // Automatically update the rooms collection to set isEmergencyLocked = true
        let affectedRooms = 0;
        try {
            const roomQuery = {};
            if (building && building !== 'ALL') {
                roomQuery.building = new RegExp(`^${building}$`, 'i');
            }
            const updateResult = await db.connection.collection('rooms').updateMany(roomQuery, {
                $set: { isEmergencyLocked: true }
            });
            affectedRooms = updateResult.modifiedCount;
        } catch (roomErr) {
            console.warn('[Emergency Service] Warning updating rooms collection:', roomErr.message);
        }

        console.log(`[Emergency Service] LOCKDOWN ACTIVATED: ${building} by ${triggeredBy}. Affected rooms: ${affectedRooms}`);

        return res.status(201).json({
            success: true,
            message: `EMERGENCY LOCKDOWN ACTIVATED FOR: ${building}. All electronic door access restricted to emergency response personnel.`,
            alert: newAlert,
            affectedRoomsCount: affectedRooms
        });
    } catch (err) {
        console.error('[Emergency Service] Lockdown error:', err);
        return res.status(500).json({
            success: false,
            message: err.message || "Error activating lockdown"
        });
    }
});

// ----------------------------------------------------
// LIFT EMERGENCY LOCKDOWN (Admin)
// POST /api/alerts/lift
// ----------------------------------------------------
app.post('/api/alerts/lift', async (req, res) => {
    try {
        const {
            alertId,
            building = 'ALL',
            resolvedBy = 'SECURITY_ADMIN',
            resolutionNotes = 'All clear confirmed by campus safety.'
        } = req.body;

        // Find and resolve the alert
        const query = { status: 'ACTIVE' };
        if (alertId) {
            query._id = alertId;
        } else if (building) {
            query.building = building;
        }

        const activeAlert = await AlertModel.findOneAndUpdate(
            query,
            {
                $set: {
                    status: 'RESOLVED',
                    resolvedAt: new Date(),
                    resolvedBy: resolvedBy,
                    resolutionNotes: resolutionNotes
                }
            },
            { new: true }
        );

        // Reset rooms emergency lock in rooms collection
        let unlockedRooms = 0;
        try {
            const roomQuery = {};
            if (building && building !== 'ALL') {
                roomQuery.building = new RegExp(`^${building}$`, 'i');
            }
            const updateResult = await db.connection.collection('rooms').updateMany(roomQuery, {
                $set: { isEmergencyLocked: false }
            });
            unlockedRooms = updateResult.modifiedCount;
        } catch (roomErr) {
            console.warn('[Emergency Service] Warning resetting rooms:', roomErr.message);
        }

        console.log(`[Emergency Service] LOCKDOWN LIFTED: ${building} by ${resolvedBy}. Unlocked rooms: ${unlockedRooms}`);

        return res.status(200).json({
            success: true,
            message: `Emergency lockdown lifted for: ${building}. Standard card access permissions restored.`,
            resolvedAlert: activeAlert,
            unlockedRoomsCount: unlockedRooms
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error lifting lockdown"
        });
    }
});

// ----------------------------------------------------
// VIEW ACTIVE EMERGENCY ALERTS (All Users)
// GET /api/alerts/active
// ----------------------------------------------------
app.get('/api/alerts/active', async (req, res) => {
    try {
        const activeAlerts = await AlertModel.find({ status: 'ACTIVE' }).sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            isEmergencyActive: activeAlerts.length > 0,
            activeCount: activeAlerts.length,
            alerts: activeAlerts
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error checking active alerts"
        });
    }
});

// ----------------------------------------------------
// REPORT SECURITY INCIDENT / DOOR TAMPER (Students, Faculty, Staff)
// POST /api/alerts/report
// ----------------------------------------------------
app.post('/api/alerts/report', async (req, res) => {
    try {
        const {
            alertType = 'SUSPICIOUS_ACTIVITY',
            building,
            description,
            severity = 'MEDIUM',
            reportedBy
        } = req.body;

        if (!description) {
            return res.status(400).json({
                success: false,
                message: "Description is required for incident reporting."
            });
        }

        const incident = new AlertModel({
            _id: generateId('INCIDENT'),
            alertType: alertType.toUpperCase().trim(),
            building: (building || 'CAMPUS').trim(),
            description: description.trim(),
            severity: severity.toUpperCase().trim(),
            triggeredBy: reportedBy || 'CAMPUS_MEMBER',
            status: 'ACTIVE'
        });

        await incident.save();

        console.log(`[Emergency Service] Incident reported: ${incident._id} [${incident.alertType}]`);

        return res.status(201).json({
            success: true,
            message: "Security incident reported successfully. Dispatch notified.",
            incident
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error reporting incident"
        });
    }
});

// ----------------------------------------------------
// VIEW ALL ALERTS & INCIDENT HISTORY (Admin)
// GET /api/alerts/history
// ----------------------------------------------------
app.get('/api/alerts/history', async (req, res) => {
    try {
        const { status, severity, limit = 50 } = req.query;
        const filter = {};

        if (status) filter.status = status.toUpperCase();
        if (severity) filter.severity = severity.toUpperCase();

        const history = await AlertModel.find(filter)
            .sort({ createdAt: -1 })
            .limit(Number(limit));

        return res.status(200).json({
            success: true,
            totalRecords: history.length,
            history
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error fetching alert history"
        });
    }
});

// ----------------------------------------------------
// DELETE / DISMISS ALERT (Admin)
// DELETE /api/alerts/:id
// ----------------------------------------------------
app.delete('/api/alerts/:id', async (req, res) => {
    try {
        const deleted = await AlertModel.findByIdAndDelete(req.params.id);
        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: "Alert not found to delete."
            });
        }

        return res.status(200).json({
            success: true,
            message: `Alert ${deleted._id} deleted successfully.`
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error deleting alert"
        });
    }
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`[Emergency Service] Running on PORT: ${PORT}`);
});

module.exports = app;
