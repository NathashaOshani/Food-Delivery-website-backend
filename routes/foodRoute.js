import crypto from "crypto";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import { addFood, listFood, removeFood, updateFood } from "../controllers/foodController.js";
import authMiddleware, { requireAdmin } from "../middleware/auth.js";
import { createReview, deleteReview, listFoodReviews, moderateReview, updateReview } from "../controllers/reviewController.js";
import { myFoodReview, listAdminFoodReviews } from "../controllers/reviewController.js";

const foodRouter = express.Router();
const storage = multer.diskStorage({
    destination: (req, file, callback) => {
        const uploadDirectory = process.env.NETLIFY === "true" || process.env.AWS_LAMBDA_FUNCTION_NAME ? "/tmp/uploads" : "./uploads";
        fs.mkdir(uploadDirectory, { recursive: true }, (error) => callback(error, uploadDirectory));
    },
    filename: (req, file, cb) => {
        const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
        cb(null, `${Date.now()}-${crypto.randomUUID()}${extensions[file.mimetype] || ""}`);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
        const valid = allowed.has(file.mimetype);
        cb(valid ? null : new Error("Only JPEG, PNG, and WebP images are allowed"), valid);
    },
});

foodRouter.get("/list", listFood);
foodRouter.get("/:id/reviews", listFoodReviews);
foodRouter.get("/:id/reviews/mine", authMiddleware, myFoodReview);
foodRouter.get("/:id/reviews/admin", authMiddleware, requireAdmin, listAdminFoodReviews);
foodRouter.post("/:id/reviews", authMiddleware, createReview);
foodRouter.put("/:id/reviews/:reviewId", authMiddleware, updateReview);
foodRouter.delete("/:id/reviews/:reviewId", authMiddleware, deleteReview);
foodRouter.patch("/:id/reviews/:reviewId/moderate", authMiddleware, requireAdmin, moderateReview);
foodRouter.post("/add", authMiddleware, requireAdmin, upload.single("image"), addFood);
foodRouter.put("/:id", authMiddleware, requireAdmin, upload.single("image"), updateFood);
foodRouter.post("/remove", authMiddleware, requireAdmin, removeFood);

export default foodRouter;
