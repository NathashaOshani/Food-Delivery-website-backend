import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema({
    foodId: { type: mongoose.Schema.Types.ObjectId, ref: "food", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "order", required: true },
    userName: { type: String, required: true, maxlength: 80 },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000, default: "" },
    isVisible: { type: Boolean, default: true, index: true },
    moderatedAt: Date,
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
}, { timestamps: true });

reviewSchema.index({ foodId: 1, userId: 1 }, { unique: true });

const reviewModel = process.env.DB_MODE === "local"
    ? (await import("../config/localModels.js")).reviewModel
    : mongoose.models.review || mongoose.model("review", reviewSchema);

export default reviewModel;
