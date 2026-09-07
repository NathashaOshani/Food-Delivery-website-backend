import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import userModel from "../models/userModel.js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
    console.error("Usage: npm run make-admin -- user@example.com");
    process.exitCode = 1;
} else {
    try {
        await connectDB();
        const user = await userModel.findOneAndUpdate({ email }, { role: "admin" }, { new: true });
        if (!user) throw new Error("No registered user has that email");
        console.log(`${user.email} is now an administrator`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}
