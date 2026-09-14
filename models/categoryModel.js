import mongoose from "mongoose";

const categorySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 50 },
    key: { type: String, required: true, unique: true },
}, { timestamps: true });

export default process.env.DB_MODE === "local"
    ? (await import("../config/localModels.js")).categoryModel
    : mongoose.models.category || mongoose.model("category", categorySchema);
