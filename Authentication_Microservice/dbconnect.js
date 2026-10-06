const mongoose = require('mongoose');
require('dotenv').config();

// Database Connection URL
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/smart_campus_access_db";

const clientOptions = {
    serverSelectionTimeoutMS: 5000,
    autoIndex: true
};

async function connectDB() {
    try {
        await mongoose.connect(MONGO_URI, clientOptions);
        console.log(`[Authentication Service] Connected successfully to MongoDB at: ${MONGO_URI.split('@').pop()}`);
    } catch (err) {
        console.error(`[Authentication Service] MongoDB Connection Error: ${err.message}`);
    }
}

connectDB();

mongoose.connection.on('disconnected', () => {
    console.warn('[Authentication Service] MongoDB disconnected. Attempting reconnect...');
});

mongoose.connection.on('error', (err) => {
    console.error(`[Authentication Service] MongoDB error: ${err.message}`);
});

module.exports = mongoose;

