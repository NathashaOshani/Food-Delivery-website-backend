import mongoose from "mongoose";

const redemptionSchema = new mongoose.Schema({ userId: { type: String, required: true }, token: { type: String, required: true } }, { _id: false });
const couponSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 32 },
    description: { type: String, trim: true, maxlength: 200, default: "" },
    type: { type: String, enum: ["percentage", "fixed"], required: true },
    value: { type: Number, required: true, min: 0.01 },
    minimumOrder: { type: Number, min: 0, default: 0 },
    startsAt: { type: Date, default: Date.now }, expiresAt: { type: Date, required: true },
    usageLimit: { type: Number, min: 1, default: null }, perCustomerLimit: { type: Number, min: 1, default: 1 },
    timesRedeemed: { type: Number, min: 0, default: 0 }, redemptions: { type: [redemptionSchema], default: [] },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

const couponModel = process.env.DB_MODE === "local"
    ? (await import("../config/localModels.js")).couponModel
    : mongoose.models.coupon || mongoose.model("coupon", couponSchema);

if (process.env.DB_MODE !== "local") {
    couponModel.claim = async ({ code, userId, token, subtotal }) => {
        const coupon = await couponModel.findOne({ code });
        if (!coupon) throw new Error("Coupon not found");
        const now = new Date();
        if (!coupon.isActive || coupon.startsAt > now || coupon.expiresAt <= now) throw new Error("Coupon is not active");
        if (subtotal < coupon.minimumOrder) throw new Error(`Minimum order amount is ${coupon.minimumOrder}`);
        const claimed = await couponModel.findOneAndUpdate({
            _id: coupon._id,
            $expr: { $and: [
                { $or: [{ $eq: ["$usageLimit", null] }, { $lt: ["$timesRedeemed", "$usageLimit"] }] },
                { $lt: [{ $size: { $filter: { input: "$redemptions", as: "redemption", cond: { $eq: ["$$redemption.userId", String(userId)] } } } }, "$perCustomerLimit"] },
            ] },
        }, { $inc: { timesRedeemed: 1 }, $push: { redemptions: { userId: String(userId), token } } }, { new: true });
        if (!claimed) throw new Error("Coupon usage limit reached");
        return claimed;
    };
    couponModel.release = async (couponId, token) => couponModel.findOneAndUpdate(
        { _id: couponId, "redemptions.token": token },
        { $inc: { timesRedeemed: -1 }, $pull: { redemptions: { token } } }, { new: true },
    );
}

export default couponModel;
