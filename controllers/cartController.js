import mongoose from "mongoose";
import foodModel from "../models/foodmodel.js";
import userModel from "../models/userModel.js";
import { hasOnlyFields } from "../config/validation.js";

const getUser = async (id) => userModel.findById(id);
const maxQuantity = 99;
const cartObject = (cartData) => Object.fromEntries(cartData);

const validItemId = (itemId) => typeof itemId === "string" && mongoose.isValidObjectId(itemId);

const addToCart = async (req, res) => {
    if (!hasOnlyFields(req.body, ["itemId"])) return res.status(400).json({ success: false, message: "Only itemId is allowed" });
    const { itemId } = req.body;
    if (!validItemId(itemId)) return res.status(400).json({ success: false, message: "A valid food id is required" });
    const food = await foodModel.findById(itemId);
    if (!food) return res.status(404).json({ success: false, message: "Food not found" });
    if (food.isAvailable === false || food.stock === 0) return res.status(409).json({ success: false, message: "Food is currently unavailable" });
    const user = await getUser(req.userId);
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    const quantity = user.cartData.get(itemId) || 0;
    if (quantity >= maxQuantity) return res.status(400).json({ success: false, message: `Maximum quantity is ${maxQuantity}` });
    if (food.stock !== null && food.stock !== undefined && quantity >= food.stock) return res.status(409).json({ success: false, message: `Only ${food.stock} are available` });
    user.cartData.set(itemId, quantity + 1);
    await user.save();
    res.json({ success: true, message: "Added to cart", cartData: cartObject(user.cartData) });
};

const removeFromCart = async (req, res) => {
    if (!hasOnlyFields(req.body, ["itemId"])) return res.status(400).json({ success: false, message: "Only itemId is allowed" });
    if (!validItemId(req.body.itemId)) return res.status(400).json({ success: false, message: "A valid food id is required" });
    const user = await getUser(req.userId);
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    const quantity = user.cartData.get(req.body.itemId) || 0;
    if (quantity > 1) user.cartData.set(req.body.itemId, quantity - 1);
    else user.cartData.delete(req.body.itemId);
    await user.save();
    res.json({ success: true, message: "Removed from cart", cartData: cartObject(user.cartData) });
};

const clearCartItem = async (req, res) => {
    if (!hasOnlyFields(req.body, ["itemId"])) return res.status(400).json({ success: false, message: "Only itemId is allowed" });
    if (!validItemId(req.body.itemId)) return res.status(400).json({ success: false, message: "A valid food id is required" });
    const user = await getUser(req.userId);
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    user.cartData.delete(req.body.itemId);
    await user.save();
    res.json({ success: true, message: "Item removed from cart", cartData: cartObject(user.cartData) });
};

const getCart = async (req, res) => {
    const user = await getUser(req.userId);
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    const itemIds = [...user.cartData.keys()].filter(validItemId);
    const availableFoods = itemIds.length ? await foodModel.find({ _id: { $in: itemIds } }) : [];
    const foodsById = new Map(availableFoods.map((food) => [String(food._id), food]));
    let changed = false;
    for (const [itemId, quantity] of user.cartData) {
        const food = foodsById.get(itemId);
        if (!food || food.isAvailable === false || food.stock === 0 || !Number.isInteger(quantity) || quantity < 1) {
            user.cartData.delete(itemId);
            changed = true;
        } else {
            const allowed = food.stock === null || food.stock === undefined ? maxQuantity : Math.min(maxQuantity, food.stock);
            if (quantity <= allowed) continue;
            user.cartData.set(itemId, allowed);
            changed = true;
        }
    }
    if (changed) await user.save();
    res.json({ success: true, cartData: cartObject(user.cartData) });
};

export { addToCart, removeFromCart, clearCartItem, getCart };
