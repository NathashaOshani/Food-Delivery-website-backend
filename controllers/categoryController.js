import categoryModel from "../models/categoryModel.js";
import { foodCategories, hasOnlyFields } from "../config/validation.js";

export const listCategories = async (req, res) => {
    const custom = await categoryModel.find({}).sort({ createdAt: 1 });
    res.json({ success: true, data: [...foodCategories.map((name) => ({ name })), ...custom.map(({ name }) => ({ name }))] });
};

export const addCategory = async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim().replace(/\s+/g, " ") : "";
    if (!hasOnlyFields(req.body, ["name"]) || name.length < 2 || name.length > 50 || /[\x00-\x1f\x7f]/.test(name)) {
        return res.status(400).json({ success: false, message: "Category name must be between 2 and 50 characters" });
    }
    const key = name.toLowerCase();
    if (key === "all" || foodCategories.some((category) => category.toLowerCase() === key)) {
        return res.status(409).json({ success: false, message: "Category already exists or is reserved" });
    }
    try {
        await categoryModel.create({ name, key });
        res.status(201).json({ success: true, data: { name }, message: "Category added" });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, message: "Category already exists" });
        throw error;
    }
};
