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
        console.log(`[Permission Service] Connected successfully to MongoDB at: ${MONGO_URI.split('@').pop()}`);
    } catch (err) {
        console.error(`[Permission Service] MongoDB Connection Error: ${err.message}`);
    }
}

connectDB();

mongoose.connection.on('disconnected', () => {
    console.warn('[Permission Service] MongoDB disconnected. Attempting reconnect...');
});

mongoose.connection.on('error', (err) => {
    console.error(`[Permission Service] MongoDB error: ${err.message}`);
});

module.exports = mongoose;

