import mongoose from "mongoose";
import foodModel from "../models/foodmodel.js";
import orderModel from "../models/orderModel.js";
import reviewModel from "../models/reviewModel.js";
import { hasOnlyFields } from "../config/validation.js";

const reviewView = (review) => ({
    id: String(review._id), foodId: String(review.foodId), userName: review.userName,
    rating: review.rating, comment: review.comment, isVisible: review.isVisible,
    createdAt: review.createdAt, updatedAt: review.updatedAt,
});

const validateReview = (body) => {
    if (!hasOnlyFields(body, ["rating", "comment"])) throw new Error("Only rating and comment are allowed");
    const rating = Number(body.rating); const comment = body.comment === undefined ? "" : String(body.comment).trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Rating must be an integer between 1 and 5");
    if (comment.length > 1000) throw new Error("Comment cannot exceed 1000 characters");
    return { rating, comment };
};

const refreshFoodRating = async (foodId) => {
    const reviews = await reviewModel.find({ foodId, isVisible: true });
    const food = await foodModel.findById(foodId); if (!food) return;
    food.ratingCount = reviews.length;
    food.ratingAverage = reviews.length ? Number((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(2)) : 0;
    await food.save();
};

export const listFoodReviews = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "A valid food id is required" });
    if (!hasOnlyFields(req.query, ["page", "limit"])) return res.status(400).json({ success: false, message: "Unknown query parameter" });
    const page = Number(req.query.page ?? 1); const limit = Number(req.query.limit ?? 10);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ success: false, message: "Page must be positive and limit must be between 1 and 100" });
    if (!(await foodModel.exists({ _id: req.params.id }))) return res.status(404).json({ success: false, message: "Food not found" });
    const query = { foodId: req.params.id, isVisible: true }; const total = await reviewModel.countDocuments(query);
    const reviews = await reviewModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    res.json({ success: true, data: reviews.map(reviewView), pagination: { page, limit, total, pages: total ? Math.ceil(total / limit) : 0 } });
};

export const createReview = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "A valid food id is required" });
    try {
        const values = validateReview(req.body);
        if (!(await foodModel.exists({ _id: req.params.id }))) return res.status(404).json({ success: false, message: "Food not found" });
        const deliveredOrders = await orderModel.find({ userId: req.userId, status: "Delivered" });
        const qualifyingOrder = deliveredOrders.find((order) => order.items.some((item) => String(item.food) === req.params.id));
        if (!qualifyingOrder) return res.status(403).json({ success: false, message: "Only customers with a delivered order can review this food" });
        const review = await reviewModel.create({ foodId: req.params.id, userId: req.userId, orderId: qualifyingOrder._id, userName: req.user.name, ...values });
        await refreshFoodRating(req.params.id);
        res.status(201).json({ success: true, data: reviewView(review) });
    } catch (error) { res.status(error.code === 11000 ? 409 : 400).json({ success: false, message: error.code === 11000 ? "You have already reviewed this food" : error.message }); }
};

export const updateReview = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.reviewId)) return res.status(400).json({ success: false, message: "Valid food and review ids are required" });
    try {
        const values = validateReview(req.body); const review = await reviewModel.findOne({ _id: req.params.reviewId, foodId: req.params.id, userId: req.userId });
        if (!review) return res.status(404).json({ success: false, message: "Review not found" });
        Object.assign(review, values); await review.save(); await refreshFoodRating(req.params.id);
        res.json({ success: true, data: reviewView(review) });
    } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

export const deleteReview = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.reviewId)) return res.status(400).json({ success: false, message: "Valid food and review ids are required" });
    const review = await reviewModel.findOne({ _id: req.params.reviewId, foodId: req.params.id, userId: req.userId });
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    await reviewModel.findByIdAndDelete(review._id); await refreshFoodRating(req.params.id);
    res.json({ success: true, message: "Review deleted" });
};

export const moderateReview = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.reviewId)) return res.status(400).json({ success: false, message: "Valid food and review ids are required" });
    if (!hasOnlyFields(req.body, ["isVisible"]) || typeof req.body.isVisible !== "boolean") return res.status(400).json({ success: false, message: "isVisible must be true or false" });
    const review = await reviewModel.findOne({ _id: req.params.reviewId, foodId: req.params.id });
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    review.isVisible = req.body.isVisible; review.moderatedAt = new Date(); review.moderatedBy = req.userId;
    await review.save(); await refreshFoodRating(req.params.id);
    res.json({ success: true, data: reviewView(review) });
};
