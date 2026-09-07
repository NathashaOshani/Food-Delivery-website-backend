import mongoose from "mongoose";

const savedAddressSchema = new mongoose.Schema({
    label: { type: String, required: true, trim: true, maxlength: 50 },
    firstName: { type: String, required: true, maxlength: 80 }, lastName: { type: String, required: true, maxlength: 80 },
    email: { type: String, required: true, maxlength: 254 }, street: { type: String, required: true, maxlength: 150 },
    city: { type: String, required: true, maxlength: 80 }, state: { type: String, required: true, maxlength: 80 },
    zipCode: { type: String, required: true, maxlength: 20 }, country: { type: String, required: true, maxlength: 80 },
    phone: { type: String, required: true, maxlength: 20 }, isDefault: { type: Boolean, default: false },
});

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    cartData: { type: Map, of: Number, default: {} },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    tokenVersion: { type: Number, default: 0, min: 0 },
    addresses: { type: [savedAddressSchema], default: [] },
    favorites: { type: [mongoose.Schema.Types.ObjectId], ref: "food", default: [] },
}, { timestamps: true });

const userModel = process.env.DB_MODE === "local"
    ? (await import("../config/localModels.js")).userModel
    : mongoose.models.user || mongoose.model("user", userSchema);

export default userModel;
