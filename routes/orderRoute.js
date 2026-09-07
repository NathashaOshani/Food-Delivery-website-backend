import express from "express";
import authMiddleware, { requireAdmin } from "../middleware/auth.js";
import { cancelOrder, getOrderConfig, listOrders, placeOrder, updateStatus, userOrders, verifyOrder } from "../controllers/orderController.js";

const orderRouter = express.Router();
orderRouter.get("/config", getOrderConfig);
orderRouter.post("/place", authMiddleware, placeOrder);
orderRouter.post("/verify", authMiddleware, verifyOrder);
orderRouter.get("/userorders", authMiddleware, userOrders);
orderRouter.post("/userorders", authMiddleware, userOrders);
orderRouter.get("/list", authMiddleware, requireAdmin, listOrders);
orderRouter.post("/status", authMiddleware, requireAdmin, updateStatus);
orderRouter.patch("/:id/cancel", authMiddleware, cancelOrder);

export default orderRouter;
