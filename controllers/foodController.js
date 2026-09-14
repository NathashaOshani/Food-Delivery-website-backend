import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import foodModel from "../models/foodmodel.js";
import reviewModel from "../models/reviewModel.js";
import userModel from "../models/userModel.js";
import categoryModel from "../models/categoryModel.js";
import { canonicalCategory, hasOnlyFields } from "../config/validation.js";

const deleteImage = async (filename) => {
    if (!filename) return;
    try {
        await fs.promises.unlink(path.join("uploads", path.basename(filename)));
    } catch (error) {
        if (error.code !== "ENOENT") console.error("Unable to delete image:", error);
    }
};

const validImageSignature = async (file) => {
    if (!file) return false;
    const handle = await fs.promises.open(file.path, "r");
    try {
        const buffer = Buffer.alloc(12);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (file.mimetype === "image/jpeg") return bytesRead >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
        if (file.mimetype === "image/png") return bytesRead >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        return file.mimetype === "image/webp" && bytesRead >= 12 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
    } finally { await handle.close(); }
};

const validateFoodFields = async (body, current = {}) => {
    if (!hasOnlyFields(body, ["name", "description", "price", "category", "isAvailable", "stock"])) return { error: "Unknown food field" };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const categoryInput = typeof body.category === "string" ? body.category.trim().replace(/\s+/g, " ") : "";
    const category = canonicalCategory(categoryInput) || (categoryInput.length <= 50 && (await categoryModel.findOne({ key: categoryInput.toLowerCase() }))?.name);
    const price = typeof body.price === "string" || typeof body.price === "number" ? Number(body.price) : NaN;
    const isAvailable = body.isAvailable === undefined ? (current.isAvailable ?? true) : body.isAvailable === true || body.isAvailable === "true" ? true : body.isAvailable === false || body.isAvailable === "false" ? false : null;
    const stock = body.stock === undefined ? (current.stock ?? null) : body.stock === "" || body.stock === null ? null : Number(body.stock);
    if (name.length < 2 || name.length > 100) return { error: "Name must be between 2 and 100 characters" };
    if (description.length < 3 || description.length > 500) return { error: "Description must be between 3 and 500 characters" };
    if (!category) return { error: "Select a valid food category" };
    if (!Number.isFinite(price) || price < 0.01 || price > 100000 || Math.round(price * 100) !== price * 100) return { error: "Price must be between 0.01 and 100000 with at most two decimal places" };
    if (isAvailable === null) return { error: "isAvailable must be true or false" };
    if (stock !== null && (!Number.isInteger(stock) || stock < 0 || stock > 1000000)) return { error: "Stock must be empty or an integer between 0 and 1000000" };
    return { name, description, category, price, isAvailable, stock };
};

const addFood = async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "An image is required" });

    try {
        if (!(await validImageSignature(req.file))) {
            await deleteImage(req.file.filename);
            return res.status(400).json({ success: false, message: "Uploaded file content is not a valid image" });
        }
        const fields = await validateFoodFields(req.body);
        if (fields.error) {
            await deleteImage(req.file.filename);
            return res.status(400).json({ success: false, message: fields.error });
        }
        const food = await foodModel.create({ ...fields, image: req.file.filename });
        res.status(201).json({ success: true, message: "Food added", data: food });
    } catch (error) {
        await deleteImage(req.file.filename);
        res.status(400).json({ success: false, message: "Unable to add food" });
    }
};

const updateFood = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        if (req.file) await deleteImage(req.file.filename);
        return res.status(400).json({ success: false, message: "A valid food id is required" });
    }

    try {
        if (req.file && !(await validImageSignature(req.file))) {
            await deleteImage(req.file.filename);
            return res.status(400).json({ success: false, message: "Uploaded file content is not a valid image" });
        }
        const food = await foodModel.findById(req.params.id);
        if (!food) {
            if (req.file) await deleteImage(req.file.filename);
            return res.status(404).json({ success: false, message: "Food not found" });
        }

        const fields = await validateFoodFields(req.body, food);
        if (fields.error) {
            if (req.file) await deleteImage(req.file.filename);
            return res.status(400).json({ success: false, message: fields.error });
        }

        const previousImage = food.image;
        Object.assign(food, fields);
        if (req.file) food.image = req.file.filename;
        await food.save();
        if (req.file && previousImage !== food.image) await deleteImage(previousImage);
        res.json({ success: true, message: "Food updated", data: food });
    } catch (error) {
        if (req.file) await deleteImage(req.file.filename);
        res.status(400).json({ success: false, message: "Unable to update food" });
    }
};

const listFood = async (req, res) => {
    if (!hasOnlyFields(req.query, ["search", "category", "sort", "page", "limit"])) return res.status(400).json({ success: false, message: "Unknown query parameter" });
    const allowedSorts = new Set(["newest", "name_asc", "price_asc", "price_desc"]);
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim().toLowerCase() : "";
    const sort = req.query.sort || "newest";
    const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined;
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 12);

    if (search.length > 100 || category.length > 50) return res.status(400).json({ success: false, message: "Search or category is too long" });
    if (!allowedSorts.has(sort)) return res.status(400).json({ success: false, message: "Invalid sort option" });
    if (paginationRequested && (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100)) {
        return res.status(400).json({ success: false, message: "Page must be positive and limit must be between 1 and 100" });
    }

    let foods = await foodModel.find({}).sort({ createdAt: -1 });
    foods = foods.filter((food) => {
        const matchesSearch = !search || food.name.toLowerCase().includes(search) || food.description.toLowerCase().includes(search);
        const matchesCategory = !category || category === "all" || food.category.toLowerCase() === category;
        return matchesSearch && matchesCategory;
    });
    foods.sort((left, right) => {
        if (sort === "name_asc") return left.name.localeCompare(right.name);
        if (sort === "price_asc") return left.price - right.price;
        if (sort === "price_desc") return right.price - left.price;
        return new Date(right.createdAt) - new Date(left.createdAt);
    });

    const total = foods.length;
    const data = paginationRequested ? foods.slice((page - 1) * limit, page * limit) : foods;
    res.json({ success: true, data, pagination: { page: paginationRequested ? page : 1, limit: paginationRequested ? limit : total, total, pages: paginationRequested ? Math.ceil(total / limit) : (total ? 1 : 0) } });
};

const removeFood = async (req, res) => {
    if (!hasOnlyFields(req.body, ["id"])) return res.status(400).json({ success: false, message: "Only id is allowed" });
    if (!mongoose.isValidObjectId(req.body.id)) return res.status(400).json({ success: false, message: "A valid food id is required" });
    const food = await foodModel.findByIdAndDelete(req.body.id);
    if (!food) return res.status(404).json({ success: false, message: "Food not found" });
    await reviewModel.deleteMany({ foodId: req.body.id });
    await userModel.updateMany({ favorites: req.body.id }, { $pull: { favorites: req.body.id } });
    await deleteImage(food.image);
    res.json({ success: true, message: "Food removed" });
};

export { addFood, updateFood, listFood, removeFood };
