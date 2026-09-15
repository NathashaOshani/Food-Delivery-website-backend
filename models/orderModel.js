import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema({
    food: { type: mongoose.Schema.Types.ObjectId, ref: "food", required: true },
    name: { type: String, required: true },
    variantId: String,
    variantName: String,
    designId: String,
    designName: String,
    price: { type: Number, required: true, min: 0 },
    image: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
}, { _id: false });

const orderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
    items: { type: [orderItemSchema], required: true },
    amount: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, min: 0 },
    deliveryFee: { type: Number, min: 0 },
    discount: { type: Number, min: 0, default: 0 },
    taxAndService: { type: Number, min: 0, default: 0 },
    coupon: { id: mongoose.Schema.Types.ObjectId, code: String, type: String, value: Number },
    couponRedemptionToken: String,
    couponUsageReleased: { type: Boolean, default: false },
    address: {
        firstName: { type: String, required: true, maxlength: 80 }, lastName: { type: String, required: true, maxlength: 80 },
        email: { type: String, required: true, maxlength: 254 }, street: { type: String, required: true, maxlength: 150 },
        city: { type: String, required: true, maxlength: 80 }, state: { type: String, required: true, maxlength: 80 },
        zipCode: { type: String, required: true, maxlength: 20 }, country: { type: String, required: true, maxlength: 80 },
        phone: { type: String, required: true, maxlength: 20 },
    },
    status: { type: String, enum: ["Food Processing", "Out for delivery", "Delivered", "Cancelled"], default: "Food Processing" },
    payment: { type: Boolean, default: false },
    paymentReviewRequired: { type: Boolean, default: false },
    paymentMethod: { type: String, enum: ["cash", "stripe"], required: true },
    idempotencyKey: { type: String, maxlength: 128 },
    requestFingerprint: String,
    stripeSessionId: String,
    stripeSessionUrl: String,
    stripePaymentIntentId: String,
    stripeLastEventId: String,
    stripeRefundId: String,
    refundStatus: { type: String, enum: ["pending", "succeeded", "failed"] },
    refundFailureReason: String,
    refundLastEventId: String,
    refundedAt: Date,
    inventoryItemIds: { type: [String], default: [] },
    inventoryRestored: { type: Boolean, default: false },
    notificationKeys: { type: [String], default: [] },
    notificationPendingKeys: { type: [String], default: [] },
    notificationLeaseUntil: { type: Date, default: () => new Date(0) },
    notificationLeaseToken: String,
    notificationLog: { type: [{ key: { type: String, required: true }, createdAt: { type: Date, default: Date.now } }], default: [] },
}, { timestamps: true });

orderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

const orderModel = process.env.DB_MODE === "local"
    ? (await import("../config/localModels.js")).orderModel
    : mongoose.models.order || mongoose.model("order", orderSchema);

export default orderModel;
