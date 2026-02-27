const mongoose = require('mongoose');

/**
 * Connect to MongoDB using the MONGO_URI from environment variables.
 * Exits the process with code 1 on failure so the app doesn't run without a DB.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // mongoose 6+ does not need these options; kept here for older versions
      // useNewUrlParser: true,
      // useUnifiedTopology: true,
    });

    console.log(`✅  MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌  MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
