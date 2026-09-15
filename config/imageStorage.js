import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import mongoose from "mongoose";

export const usesMongoImages = () => process.env.IMAGE_STORAGE === "mongodb";
export const imageBucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "foodImages" });
const mimeTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
export const imageMimeType = (filename) => mimeTypes[path.extname(filename).toLowerCase()];

export const uploadImageToMongo = async (filename, filePath) => {
    if (path.basename(filename) !== filename || !imageMimeType(filename)) throw new Error("Invalid image filename");
    const bucket = imageBucket();
    const stream = bucket.openUploadStream(filename, { metadata: { contentType: imageMimeType(filename) } });
    try { await pipeline(fs.createReadStream(filePath), stream); }
    catch (error) { await stream.abort().catch(() => {}); throw error; }
};

export const persistUploadedImage = async (file) => {
    if (!usesMongoImages()) return;
    await uploadImageToMongo(file.filename, file.path);
    await fs.promises.unlink(file.path).catch(() => {});
};

export const deleteStoredImage = async (filename) => {
    if (!filename) return;
    const safeName = path.basename(filename);
    if (usesMongoImages()) {
        const bucket = imageBucket();
        for await (const file of bucket.find({ filename: safeName })) await bucket.delete(file._id);
    }
    await fs.promises.unlink(path.join("uploads", safeName)).catch((error) => { if (error.code !== "ENOENT") throw error; });
};

export const serveMongoImage = async (req, res, next) => {
    if (!usesMongoImages()) return next();
    const filename = req.params.filename;
    if (path.basename(filename) !== filename || !imageMimeType(filename)) return res.sendStatus(404);
    try {
        const bucket = imageBucket();
        const file = await bucket.find({ filename }).sort({ uploadDate: -1 }).limit(1).next();
        if (!file) return next();
        res.type(imageMimeType(filename));
        res.set("Cache-Control", "public, max-age=3600");
        res.set("Content-Length", String(file.length));
        if (req.method === "HEAD") return res.end();
        const stream = bucket.openDownloadStream(file._id);
        res.on("close", () => stream.destroy());
        stream.on("error", (error) => { if (res.headersSent) res.destroy(error); else { res.removeHeader("Content-Length"); next(error); } });
        stream.pipe(res);
    } catch (error) { next(error); }
};
