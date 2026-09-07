import express from "express";
import authMiddleware, { requireAdmin } from "../middleware/auth.js";
import { createCoupon, deleteCoupon, listCoupons, updateCoupon, validateCoupon } from "../controllers/couponController.js";

const couponRouter = express.Router();
couponRouter.post("/validate", authMiddleware, validateCoupon);
couponRouter.get("/", authMiddleware, requireAdmin, listCoupons);
couponRouter.post("/", authMiddleware, requireAdmin, createCoupon);
couponRouter.put("/:id", authMiddleware, requireAdmin, updateCoupon);
couponRouter.delete("/:id", authMiddleware, requireAdmin, deleteCoupon);
export default couponRouter;
