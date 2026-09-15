import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/db.js";
import { imageBucket, imageMimeType, uploadImageToMongo } from "../config/imageStorage.js";

// Run without --apply to inspect only. Local files and food documents stay intact.
mongoose.set("autoCreate", false); mongoose.set("autoIndex", false);
try {
    if (process.env.DB_MODE === "local") throw new Error("Image migration requires MongoDB");
    await connectDB();
    const foods = await mongoose.connection.db.collection("foods").find({}, { projection: { image: 1 } }).toArray();
    let uploaded = 0, existing = 0, missing = 0, bytes = 0;
    const apply = process.argv.includes("--apply");
    for (const filename of new Set(foods.map((food) => food.image))) {
        if (typeof filename !== "string" || path.basename(filename) !== filename || !imageMimeType(filename)) { missing++; continue; }
        const bucket = imageBucket();
        if (await bucket.find({ filename }).limit(1).next()) { existing++; continue; }
        let source, content;
        for (const folder of ["uploads", "assets"]) {
            try { source = path.resolve(folder, filename); content = await fs.readFile(source); break; }
            catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        if (!content) { missing++; continue; }
        bytes += content.length;
        if (apply) {
            await uploadImageToMongo(filename, source);
            const hash = crypto.createHash("sha256");
            for await (const chunk of bucket.openDownloadStreamByName(filename)) hash.update(chunk);
            if (hash.digest("hex") !== crypto.createHash("sha256").update(content).digest("hex")) throw new Error("Migrated image verification failed");
            uploaded++;
        }
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "read-only", uploaded, existing, missing, bytesToCopy: bytes }));
    if (missing) process.exitCode = 1;
} catch (error) { console.error("Image migration failed:", error.name); process.exitCode = 1; }
finally { await disconnectDB(); }
