import mongoose from "mongoose";
import foodModel from "../models/foodmodel.js";
import userModel from "../models/userModel.js";
import { hasOnlyFields } from "../config/validation.js";
import { cartKey, splitCartKey, selectVariant, selectDesign, cakeDesigns, validVariantId } from "../config/foodOptions.js";

const getUser = async (id) => userModel.findById(id);
const maxQuantity = 99;
const cartObject = (cartData) => Object.fromEntries(cartData);

const validItemId = (itemId) => typeof itemId === "string" && mongoose.isValidObjectId(itemId);

const addToCart = async (req, res) => {
    if (!hasOnlyFields(req.body, ["itemId", "quantity", "variantId", "designId"])) return res.status(400).json({ success: false, message: "Only itemId, quantity, variantId, and designId are allowed" });
    const requestedQuantity = req.body.quantity === undefined ? 1 : req.body.quantity;
    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > maxQuantity) return res.status(400).json({ success: false, message: `Quantity must be an integer between 1 and ${maxQuantity}` });
    const { itemId } = req.body;
    if (!validItemId(itemId)) return res.status(400).json({ success: false, message: "A valid food id is required" });
    const food = await foodModel.findById(itemId);
    if (!food) return res.status(404).json({ success: false, message: "Food not found" });
    try { selectDesign(food, req.body.designId); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    try { selectVariant(food, req.body.variantId, req.body.designId); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    if (food.isAvailable === false || food.stock === 0) return res.status(409).json({ success: false, message: "Food is currently unavailable" });
    const user = await getUser(req.userId);
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    const key = cartKey(itemId, req.body.variantId, req.body.designId);
    const quantity = user.cartData.get(key) || 0;
    const totalQuantity = [...user.cartData].reduce((total, [entryKey, count]) => total + (splitCartKey(entryKey).itemId === itemId ? count : 0), 0);
    if (quantity + requestedQuantity > maxQuantity) return res.status(400).json({ success: false, message: `Maximum quantity is ${maxQuantity}` });
    if (food.stock !== null && food.stock !== undefined && totalQuantity + requestedQuantity > food.stock) return res.status(409).json({ success: false, message: `Only ${food.stock} are available` });
    user.cartData.set(key, quantity + requestedQuantity);
    await user.save();
    res.json({ success: true, message: "Added to cart", cartData: cartObject(user.cartData) });
};

const removeFromCart = async (req, res) => {
    if (!hasOnlyFields(req.body, ["itemId", "variantId", "designId"]) || (req.body.variantId !== undefined && !validVariantId(req.body.variantId)) || (req.body.designId !== undefined && !cakeDesigns.some((design) => design.id === req.body.designId))) return res.status(400).json({ success: false, message: "A valid itemId, optional variantId, and optional designId are required" });
    if (!validItemId(req.body.itemId)) return res.status(400).json({ success: false, message: "A valid food id is required" });
    const user = await getUser(req.userId);
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    const key = cartKey(req.body.itemId, req.body.variantId, req.body.designId);
    const quantity = user.cartData.get(key) || 0;
    if (quantity > 1) user.cartData.set(key, quantity - 1);
    else user.cartData.delete(key);
    await user.save();
    res.json({ success: true, message: "Removed from cart", cartData: cartObject(user.cartData) });
};

const clearCartItem = async (req, res) => {
    if (!hasOnlyFields(req.body, ["itemId", "variantId", "designId"]) || (req.body.variantId !== undefined && !validVariantId(req.body.variantId)) || (req.body.designId !== undefined && !cakeDesigns.some((design) => design.id === req.body.designId))) return res.status(400).json({ success: false, message: "A valid itemId, optional variantId, and optional designId are required" });
    if (!validItemId(req.body.itemId)) return res.status(400).json({ success: false, message: "A valid food id is required" });
    const user = await getUser(req.userId);
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    user.cartData.delete(cartKey(req.body.itemId, req.body.variantId, req.body.designId));
    await user.save();
    res.json({ success: true, message: "Item removed from cart", cartData: cartObject(user.cartData) });
};

const getCart = async (req, res) => {
    const user = await getUser(req.userId);
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    const itemIds = [...new Set([...user.cartData.keys()].map(splitCartKey).filter((entry) => entry.valid).map((entry) => entry.itemId))];
    const availableFoods = itemIds.length ? await foodModel.find({ _id: { $in: itemIds } }) : [];
    const foodsById = new Map(availableFoods.map((food) => [String(food._id), food]));
    let changed = false;
    const allocated = new Map();
    for (const [key, quantity] of user.cartData) {
        const { itemId, variantId, designId, valid } = splitCartKey(key);
        const food = foodsById.get(itemId);
        let validOption = valid && Boolean(food);
        if (validOption) { try { selectDesign(food, designId); } catch { validOption = false; } }
        if (validOption) { try { selectVariant(food, variantId, designId); } catch { validOption = false; } }
        if (!validOption || food.isAvailable === false || food.stock === 0 || !Number.isInteger(quantity) || quantity < 1) {
            user.cartData.delete(key);
            changed = true;
        } else {
            const allowed = food.stock == null ? maxQuantity : Math.max(0, Math.min(maxQuantity, food.stock - (allocated.get(itemId) || 0)));
            const kept = Math.min(quantity, allowed);
            allocated.set(itemId, (allocated.get(itemId) || 0) + kept);
            if (kept !== quantity) {
                if (kept) user.cartData.set(key, kept); else user.cartData.delete(key);
                changed = true;
            }
        }
    }
    if (changed) await user.save();
    res.json({ success: true, cartData: cartObject(user.cartData) });
};

export { addToCart, removeFromCart, clearCartItem, getCart };
