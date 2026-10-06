const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
    {
        _id: { type: String },
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: { type: String, required: true },
        role: { 
            type: String, 
            enum: ['admin', 'faculty', 'student'], 
            default: 'student',
            required: true 
        },
        department: { type: String, default: 'General Studies' },
        phone: { type: String, default: '' },
        cardId: { type: String, unique: true, sparse: true },
        isActive: { type: Boolean, default: true }
    },
    {
        timestamps: true,
        collection: 'users'
    }
);

module.exports = mongoose.model('User', UserSchema);
