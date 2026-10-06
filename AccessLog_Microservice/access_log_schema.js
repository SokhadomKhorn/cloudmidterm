const mongoose = require('mongoose');

const AccessLogSchema = new mongoose.Schema(
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
        building: { type: String, default: 'Main Campus' },
        status: { 
            type: String, 
            enum: ['GRANTED', 'DENIED'], 
            required: true 
        },
        denialReason: { type: String, default: null },
        servedByInstance: { type: String, default: 'AccessLog-Instance-1' },
        swipeTimestamp: { type: Date, default: Date.now }
    },
    {
        timestamps: true,
        collection: 'access_logs'
    }
);

// Indexes for query performance
AccessLogSchema.index({ status: 1 });
AccessLogSchema.index({ userEmail: 1 });
AccessLogSchema.index({ roomNumber: 1 });
AccessLogSchema.index({ swipeTimestamp: -1 });

module.exports = mongoose.model('AccessLog', AccessLogSchema);
