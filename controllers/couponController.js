import mongoose from "mongoose";
import couponModel from "../models/couponModel.js";
import { hasOnlyFields } from "../config/validation.js";

const allowedFields = ["code", "description", "type", "value", "minimumOrder", "startsAt", "expiresAt", "usageLimit", "perCustomerLimit", "isActive"];
const normalizeCoupon = (body, current = {}) => {
    if (!hasOnlyFields(body, allowedFields)) throw new Error("Unknown coupon field");
    const code = String(body.code ?? current.code ?? "").trim().toUpperCase();
    const description = String(body.description ?? current.description ?? "").trim();
    const type = body.type ?? current.type;
    const value = Number(body.value ?? current.value);
    const minimumOrder = Number(body.minimumOrder ?? current.minimumOrder ?? 0);
    const startsAt = new Date(body.startsAt ?? current.startsAt ?? Date.now());
    const expiresAt = new Date(body.expiresAt ?? current.expiresAt);
    const usageLimit = body.usageLimit === null || body.usageLimit === "" ? null : Number(body.usageLimit ?? current.usageLimit ?? NaN);
    const perCustomerLimit = Number(body.perCustomerLimit ?? current.perCustomerLimit ?? 1);
    const isActive = body.isActive ?? current.isActive ?? true;
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new Error("Code must be 3-32 letters, numbers, underscores, or hyphens");
    if (description.length > 200) throw new Error("Description cannot exceed 200 characters");
    if (!["percentage", "fixed"].includes(type)) throw new Error("Type must be percentage or fixed");
    if (!Number.isFinite(value) || value <= 0 || (type === "percentage" && value > 100)) throw new Error(type === "percentage" ? "Percentage must be between 0 and 100" : "Fixed discount must be greater than zero");
    if (!Number.isFinite(minimumOrder) || minimumOrder < 0) throw new Error("Minimum order must be zero or greater");
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(expiresAt.getTime()) || expiresAt <= startsAt) throw new Error("Coupon dates are invalid");
    if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1)) throw new Error("Usage limit must be empty or a positive integer");
    if (!Number.isInteger(perCustomerLimit) || perCustomerLimit < 1) throw new Error("Per-customer limit must be a positive integer");
    if (typeof isActive !== "boolean") throw new Error("isActive must be true or false");
    return { code, description, type, value, minimumOrder, startsAt, expiresAt, usageLimit, perCustomerLimit, isActive };
};

export const calculateDiscount = (coupon, subtotal) => Math.min(subtotal, Number((coupon.type === "percentage" ? subtotal * coupon.value / 100 : coupon.value).toFixed(2)));
const couponView = (coupon) => { const data = coupon.toObject ? coupon.toObject() : { ...coupon }; delete data.redemptions; delete data.save; delete data.deleteOne; return data; };

export const createCoupon = async (req, res) => {
    try { const coupon = await couponModel.create(normalizeCoupon(req.body)); res.status(201).json({ success: true, data: couponView(coupon) }); }
    catch (error) { res.status(error.code === 11000 ? 409 : 400).json({ success: false, message: error.code === 11000 ? "Coupon code already exists" : error.message }); }
};
export const listCoupons = async (req, res) => res.json({ success: true, data: (await couponModel.find({}).sort({ createdAt: -1 })).map(couponView) });
export const updateCoupon = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "A valid coupon id is required" });
    const coupon = await couponModel.findById(req.params.id); if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found" });
    try { Object.assign(coupon, normalizeCoupon(req.body, coupon)); await coupon.save(); res.json({ success: true, data: couponView(coupon) }); }
    catch (error) { res.status(error.code === 11000 ? 409 : 400).json({ success: false, message: error.code === 11000 ? "Coupon code already exists" : error.message }); }
};
export const deleteCoupon = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "A valid coupon id is required" });
    const coupon = await couponModel.findByIdAndDelete(req.params.id); res.status(coupon ? 200 : 404).json({ success: Boolean(coupon), message: coupon ? "Coupon deleted" : "Coupon not found" });
};
export const validateCoupon = async (req, res) => {
    if (!hasOnlyFields(req.body, ["code", "subtotal"])) return res.status(400).json({ success: false, message: "Only code and subtotal are allowed" });
    const code = typeof req.body.code === "string" ? req.body.code.trim().toUpperCase() : ""; const subtotal = Number(req.body.subtotal);
    if (!code || !Number.isFinite(subtotal) || subtotal < 0) return res.status(400).json({ success: false, message: "A coupon code and valid subtotal are required" });
    const coupon = await couponModel.findOne({ code }); const now = new Date();
    if (!coupon || !coupon.isActive || new Date(coupon.startsAt) > now || new Date(coupon.expiresAt) <= now) return res.status(404).json({ success: false, message: "Coupon is not active" });
    if (subtotal < coupon.minimumOrder) return res.status(400).json({ success: false, message: `Minimum order amount is ${coupon.minimumOrder}` });
    const userUses = coupon.redemptions.filter((item) => item.userId === String(req.userId)).length;
    if ((coupon.usageLimit && coupon.timesRedeemed >= coupon.usageLimit) || userUses >= coupon.perCustomerLimit) return res.status(409).json({ success: false, message: "Coupon usage limit reached" });
    res.json({ success: true, data: { code: coupon.code, discount: calculateDiscount(coupon, subtotal), subtotal, totalAfterDiscount: Number((subtotal - calculateDiscount(coupon, subtotal)).toFixed(2)) } });
};
