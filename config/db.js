import mongoose from "mongoose";
import dns from "dns";

let databaseReady = false;

const resolveAtlasHost = async (hostname) => {
    const record = `_mongodb._tcp.${hostname}`;
    const resolveWithTimeout = () => Promise.race([
        dns.promises.resolveSrv(record),
        new Promise((resolve, reject) => setTimeout(() => reject(new Error("DNS lookup timed out")), 3000)),
    ]);

    try {
        await resolveWithTimeout();
    } catch (systemDnsError) {
        // Some routers and mobile hotspots don't support the SRV lookups Atlas uses.
        // Public resolvers provide a reliable fallback and are also used by the driver.
        dns.setServers(["1.1.1.1", "8.8.8.8"]);
        try {
            await resolveWithTimeout();
        } catch (publicDnsError) {
            throw new Error(`Unable to resolve MongoDB Atlas host '${hostname}': ${publicDnsError.message}`);
        }
    }
};

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
        await resolveAtlasHost(hostname);
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
