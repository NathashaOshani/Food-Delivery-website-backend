import express from "express";
import { addCategory, listCategories } from "../controllers/categoryController.js";
import authMiddleware, { requireAdmin } from "../middleware/auth.js";

const router = express.Router();
router.get("/list", listCategories);
router.post("/add", authMiddleware, requireAdmin, addCategory);
export default router;
