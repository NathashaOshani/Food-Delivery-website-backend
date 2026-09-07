import mongoose from "mongoose";
import dns from "dns/promises";

let databaseReady = false;

export const connectDB = async () => {
    let mongoUri = process.env.MONGODB_URI;

    if (process.env.DB_MODE === "local") {
        databaseReady = true;
        console.log("Using local JSON database for development");
        return;
    }

    if (!mongoUri) throw new Error("MONGODB_URI is not configured");

    if (mongoUri.startsWith("mongodb+srv://")) {
        const hostname = new URL(mongoUri.replace("mongodb+srv://", "http://")).hostname;
        try {
            await Promise.race([
                dns.resolveSrv(`_mongodb._tcp.${hostname}`),
                new Promise((resolve, reject) => setTimeout(() => reject(new Error("DNS lookup timed out")), 3000)),
            ]);
        } catch {
            throw new Error(`MongoDB Atlas host '${hostname}' does not exist. Update MONGODB_URI in .env with the current Atlas connection string.`);
        }
    }

    await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
    });
    databaseReady = true;
    console.log("MongoDB connected");
};

export const isDatabaseReady = () => process.env.DB_MODE === "local" ? databaseReady : databaseReady && mongoose.connection.readyState === 1;

export const disconnectDB = async () => {
    databaseReady = false;
    await mongoose.disconnect();
};
