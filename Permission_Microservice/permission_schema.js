const mongoose = require('mongoose');

const PermissionSchema = new mongoose.Schema(
    {
        _id: { type: String },
        userId: { type: String, required: true },
        userEmail: { type: String, required: true, lowercase: true, trim: true },
        userRole: { 
            type: String, 
            enum: ['admin', 'faculty', 'student'], 
            required: true 
        },
        roomId: { type: String, required: true },
        roomNumber: { type: String, required: true, uppercase: true, trim: true },
        allowedDays: { 
            type: [String], 
            default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] 
        },
        startTime: { type: String, default: '08:00' }, // HH:mm
        endTime: { type: String, default: '20:00' },   // HH:mm
        validFrom: { type: Date, default: Date.now },
        validUntil: { 
            type: Date, 
            default: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) 
        },
        isActive: { type: Boolean, default: true },
        grantedBy: { type: String, default: 'SYSTEM_ADMIN' }
    },
    {
        timestamps: true,
        collection: 'access_permissions'
    }
);

// Compound index for fast access lookup
PermissionSchema.index({ userId: 1, roomId: 1 });
PermissionSchema.index({ userEmail: 1, roomNumber: 1 });

module.exports = mongoose.model('AccessPermission', PermissionSchema);
