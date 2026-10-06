const mongoose = require('mongoose');

const EmergencyAlertSchema = new mongoose.Schema(
    {
        _id: { type: String },
        alertType: { 
            type: String, 
            enum: ['CAMPUS_LOCKDOWN', 'BUILDING_LOCKDOWN', 'SECURITY_BREACH', 'SUSPICIOUS_ACTIVITY', 'FIRE_HAZARD', 'UNAUTHORIZED_DOOR_TAMPER'], 
            required: true 
        },
        building: { type: String, default: 'ALL' },
        description: { type: String, required: true },
        severity: { 
            type: String, 
            enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], 
            default: 'HIGH' 
        },
        triggeredBy: { type: String, required: true },
        status: { 
            type: String, 
            enum: ['ACTIVE', 'RESOLVED'], 
            default: 'ACTIVE' 
        },
        resolvedAt: { type: Date, default: null },
        resolvedBy: { type: String, default: null },
        resolutionNotes: { type: String, default: null }
    },
    {
        timestamps: true,
        collection: 'emergency_alerts'
    }
);

EmergencyAlertSchema.index({ status: 1 });
EmergencyAlertSchema.index({ alertType: 1 });
EmergencyAlertSchema.index({ building: 1 });

module.exports = mongoose.model('EmergencyAlert', EmergencyAlertSchema);
