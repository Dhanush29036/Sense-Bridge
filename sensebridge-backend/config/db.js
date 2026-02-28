const mongoose = require('mongoose');

/**
 * Connect to MongoDB.
 * Strategy:
 *  1. Try the MONGO_URI from .env (local or Atlas).
 *  2. If that fails AND we are in development, auto-start mongodb-memory-server
 *     so the app works without a locally installed MongoDB.
 */
const connectDB = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/sensebridge';

  // Helper: attempt a Mongoose connection and return the connection object
  const tryConnect = async (connectionUri, label) => {
    try {
      const conn = await mongoose.connect(connectionUri, {
        serverSelectionTimeoutMS: 3000,   // fail fast vs slow timeout
      });
      console.log(`✅  MongoDB connected [${label}]: ${conn.connection.host}`);
      return conn;
    } catch {
      return null;
    }
  };

  // --- 1. Try primary URI ---
  const primary = await tryConnect(uri, 'primary');
  if (primary) return;

  // --- 2. Fallback: in-memory MongoDB (dev / demo only) ---
  const isDev = (process.env.NODE_ENV || 'development') !== 'production';
  if (!isDev) {
    console.error('❌  MongoDB connection failed. Exiting.');
    process.exit(1);
  }

  console.warn('⚠️  Could not reach MongoDB — starting embedded in-memory server (demo mode).');
  try {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const memServer = await MongoMemoryServer.create();
    const memUri = memServer.getUri();
    const conn = await mongoose.connect(memUri);
    console.log(`✅  MongoDB connected [in-memory / demo]: ${conn.connection.host}`);

    // Clean shutdown
    process.on('SIGINT', async () => { await mongoose.disconnect(); await memServer.stop(); process.exit(0); });
    process.on('SIGTERM', async () => { await mongoose.disconnect(); await memServer.stop(); process.exit(0); });
  } catch (memErr) {
    console.error('❌  Failed to start in-memory MongoDB:', memErr.message);
    process.exit(1);
  }
};

module.exports = connectDB;
