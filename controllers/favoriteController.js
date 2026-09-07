import mongoose from "mongoose";
import foodModel from "../models/foodmodel.js";
import userModel from "../models/userModel.js";
import { hasOnlyFields, isPlainObject } from "../config/validation.js";

const emptyBody = (body) => body === undefined || (isPlainObject(body) && Object.keys(body).length === 0);

export const listFavorites = async (req, res) => {
    if (!hasOnlyFields(req.query, ["page", "limit"])) return res.status(400).json({ success: false, message: "Unknown query parameter" });
    const page = Number(req.query.page ?? 1); const limit = Number(req.query.limit ?? 12);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ success: false, message: "Page must be positive and limit must be between 1 and 100" });
    const user = await userModel.findById(req.userId); if (!user) return res.status(401).json({ success: false, message: "User not found" });
    const ids = (user.favorites || []).map(String).filter((id) => mongoose.isValidObjectId(id));
    const foods = ids.length ? await foodModel.find({ _id: { $in: ids } }) : [];
    const foodsById = new Map(foods.map((food) => [String(food._id), food])); const validIds = ids.filter((id) => foodsById.has(id));
    if (validIds.length !== ids.length) { user.favorites = validIds; await user.save(); }
    const ordered = validIds.map((id) => foodsById.get(id)); const total = ordered.length;
    res.json({ success: true, data: ordered.slice((page - 1) * limit, page * limit), pagination: { page, limit, total, pages: total ? Math.ceil(total / limit) : 0 } });
};

export const addFavorite = async (req, res) => {
    if (!emptyBody(req.body)) return res.status(400).json({ success: false, message: "Request body must be empty" });
    if (!mongoose.isValidObjectId(req.params.foodId)) return res.status(400).json({ success: false, message: "A valid food id is required" });
    if (!(await foodModel.exists({ _id: req.params.foodId }))) return res.status(404).json({ success: false, message: "Food not found" });
    const user = await userModel.findByIdAndUpdate(req.userId, { $addToSet: { favorites: req.params.foodId } }, { new: true });
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    res.json({ success: true, message: "Added to favorites" });
};

export const removeFavorite = async (req, res) => {
    if (!emptyBody(req.body)) return res.status(400).json({ success: false, message: "Request body must be empty" });
    if (!mongoose.isValidObjectId(req.params.foodId)) return res.status(400).json({ success: false, message: "A valid food id is required" });
    const user = await userModel.findByIdAndUpdate(req.userId, { $pull: { favorites: req.params.foodId } }, { new: true });
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    res.json({ success: true, message: "Removed from favorites" });
};
