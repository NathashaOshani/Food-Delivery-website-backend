import "dotenv/config";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/db.js";

console.log("Configured database:", process.env.DB_MODE === "local" ? "local JSON" : "MongoDB");
try {
    const response = await fetch(`http://127.0.0.1:${Number(process.env.PORT) || 4000}/health/ready`, { signal: AbortSignal.timeout(3000) });
    const health = await response.json();
    console.log("Running backend:", response.status, JSON.stringify(health));
} catch { console.log("Running backend readiness endpoint is unavailable."); }
try {
    await connectDB();
    if (process.env.DB_MODE !== "local") {
        const result = await mongoose.connection.db.command({ ping: 1 });
        console.log("MongoDB ping:", result.ok === 1 ? "succeeded" : "failed");
    }
} catch (error) {
    console.error("Database connection failed:", error.code || error.name);
    process.exitCode = 1;
} finally { await disconnectDB(); }
