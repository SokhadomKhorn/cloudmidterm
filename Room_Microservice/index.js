const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

const db = require('./dbconnect.js');
const RoomModel = require('./room_schema.js');

const PORT = process.env.PORT || 5003;

function generateId(prefix = 'ROOM') {
    const rand = Math.floor(100 + Math.random() * 900);
    return `${prefix}-${Date.now().toString().slice(-4)}${rand}`;
}

// ----------------------------------------------------
// Health Check API
// ----------------------------------------------------
app.get('/health', (req, res) => {
    return res.status(200).json({
        service: 'Room Management Microservice (Team Member 1)',
        status: 'UP',
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

// ----------------------------------------------------
// CREATE ROOM API (Admin)
// POST /api/rooms
// ----------------------------------------------------
app.post('/api/rooms', async (req, res) => {
    try {
        const {
            roomNumber,
            roomName,
            building,
            floor = 1,
            roomType = 'CLASSROOM',
            capacity = 30,
            securityClearance = 'GENERAL'
        } = req.body;

        if (!roomNumber || !roomName || !building) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields: roomNumber, roomName, and building are mandatory."
            });
        }

        const normalizedNumber = roomNumber.toUpperCase().trim();

        // Check if room number already exists
        const existing = await RoomModel.findOne({ roomNumber: normalizedNumber });
        if (existing) {
            return res.status(409).json({
                success: false,
                message: `Room with number '${normalizedNumber}' already exists.`
            });
        }

        const newRoom = new RoomModel({
            _id: generateId('ROOM'),
            roomNumber: normalizedNumber,
            roomName: roomName.trim(),
            building: building.trim(),
            floor: Number(floor),
            roomType: roomType.toUpperCase().trim(),
            capacity: Number(capacity),
            securityClearance: securityClearance.toUpperCase().trim(),
            isLocked: false,
            isEmergencyLocked: false
        });

        await newRoom.save();
        console.log(`[Room Service] Room created: ${newRoom.roomNumber} - ${newRoom.roomName}`);

        return res.status(201).json({
            success: true,
            message: "Room created successfully",
            room: newRoom
        });
    } catch (err) {
        console.error('[Room Service] Create error:', err);
        return res.status(500).json({
            success: false,
            message: err.message || "Error creating room"
        });
    }
});

// ----------------------------------------------------
// GET ALL ROOMS API (With Filters)
// GET /api/rooms?building=...&roomType=...&securityClearance=...
// ----------------------------------------------------
app.get('/api/rooms', async (req, res) => {
    try {
        const { building, roomType, securityClearance, isLocked } = req.query;
        const filter = {};

        if (building) filter.building = new RegExp(building, 'i');
        if (roomType) filter.roomType = roomType.toUpperCase();
        if (securityClearance) filter.securityClearance = securityClearance.toUpperCase();
        if (isLocked !== undefined) filter.isLocked = isLocked === 'true';

        const rooms = await RoomModel.find(filter).sort({ building: 1, roomNumber: 1 });

        return res.status(200).json({
            success: true,
            totalRooms: rooms.length,
            rooms
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error fetching rooms"
        });
    }
});

// ----------------------------------------------------
// GET ROOM BY ID OR ROOM NUMBER
// GET /api/rooms/:id
// ----------------------------------------------------
app.get('/api/rooms/:id', async (req, res) => {
    try {
        const param = req.params.id;
        const room = await RoomModel.findOne({
            $or: [{ _id: param }, { roomNumber: param.toUpperCase() }]
        });

        if (!room) {
            return res.status(404).json({
                success: false,
                message: `Room '${param}' not found.`
            });
        }

        return res.status(200).json({
            success: true,
            room
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error retrieving room"
        });
    }
});

// ----------------------------------------------------
// UPDATE ROOM API (Admin)
// PUT /api/rooms/:id
// ----------------------------------------------------
app.put('/api/rooms/:id', async (req, res) => {
    try {
        const param = req.params.id;
        const updateData = { ...req.body };

        if (updateData.roomNumber) updateData.roomNumber = updateData.roomNumber.toUpperCase().trim();
        if (updateData.roomType) updateData.roomType = updateData.roomType.toUpperCase().trim();
        if (updateData.securityClearance) updateData.securityClearance = updateData.securityClearance.toUpperCase().trim();

        const updatedRoom = await RoomModel.findOneAndUpdate(
            { $or: [{ _id: param }, { roomNumber: param.toUpperCase() }] },
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedRoom) {
            return res.status(404).json({
                success: false,
                message: `Room '${param}' not found for update.`
            });
        }

        return res.status(200).json({
            success: true,
            message: "Room updated successfully",
            room: updatedRoom
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error updating room"
        });
    }
});

// ----------------------------------------------------
// TOGGLE ROOM LOCK STATUS (Admin / Faculty)
// PATCH /api/rooms/:id/toggle-lock
// ----------------------------------------------------
app.patch('/api/rooms/:id/toggle-lock', async (req, res) => {
    try {
        const param = req.params.id;
        const room = await RoomModel.findOne({
            $or: [{ _id: param }, { roomNumber: param.toUpperCase() }]
        });

        if (!room) {
            return res.status(404).json({
                success: false,
                message: `Room '${param}' not found.`
            });
        }

        const newState = req.body.isLocked !== undefined ? Boolean(req.body.isLocked) : !room.isLocked;
        room.isLocked = newState;
        await room.save();

        console.log(`[Room Service] Room ${room.roomNumber} lock status toggled to: ${room.isLocked}`);

        return res.status(200).json({
            success: true,
            message: `Room ${room.roomNumber} is now ${room.isLocked ? 'LOCKED' : 'UNLOCKED'}.`,
            room
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error toggling lock status"
        });
    }
});

// ----------------------------------------------------
// BATCH EMERGENCY LOCKDOWN TOGGLE (Internal Emergency Service)
// PATCH /api/rooms/emergency/set-lockdown
// ----------------------------------------------------
app.patch('/api/rooms/emergency/set-lockdown', async (req, res) => {
    try {
        const { building, emergencyLocked } = req.body;
        const query = {};
        if (building && building !== 'ALL') {
            query.building = new RegExp(`^${building}$`, 'i');
        }

        const update = { isEmergencyLocked: Boolean(emergencyLocked) };
        const result = await RoomModel.updateMany(query, { $set: update });

        return res.status(200).json({
            success: true,
            message: `Emergency lockdown ${emergencyLocked ? 'ACTIVATED' : 'LIFTED'} for ${result.modifiedCount} rooms.`,
            affectedRooms: result.modifiedCount
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error updating emergency lockdown state"
        });
    }
});

// ----------------------------------------------------
// DELETE ROOM API (Admin)
// DELETE /api/rooms/:id
// ----------------------------------------------------
app.delete('/api/rooms/:id', async (req, res) => {
    try {
        const param = req.params.id;
        const deleted = await RoomModel.findOneAndDelete({
            $or: [{ _id: param }, { roomNumber: param.toUpperCase() }]
        });

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: `Room '${param}' not found to delete.`
            });
        }

        console.log(`[Room Service] Room deleted: ${deleted.roomNumber}`);

        return res.status(200).json({
            success: true,
            message: `Room ${deleted.roomNumber} (${deleted.roomName}) deleted successfully.`,
            deletedRoomId: deleted._id
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Error deleting room"
        });
    }
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`[Room Service] Running on PORT: ${PORT}`);
});

module.exports = app;
