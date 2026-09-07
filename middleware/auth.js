import jwt from "jsonwebtoken";
import userModel from "../models/userModel.js";

const authMiddleware = async (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers.token;
    if (!token) return res.status(401).json({ success: false, message: "Authentication required" });
    if (!process.env.JWT_SECRET) return res.status(500).json({ success: false, message: "JWT_SECRET is not configured" });

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (!payload.id) return res.status(401).json({ success: false, message: "Invalid or expired token" });

        const user = await userModel.findById(payload.id).select("name email role tokenVersion");
        if (!user) return res.status(401).json({ success: false, message: "Account no longer exists" });
        if (Number(payload.v ?? 0) !== Number(user.tokenVersion ?? 0)) return res.status(401).json({ success: false, message: "Session expired. Please sign in again." });

        req.userId = user._id;
        req.user = user;
        next();
    } catch {
        res.status(401).json({ success: false, message: "Invalid or expired token" });
    }
};

export default authMiddleware;

export const requireAdmin = async (req, res, next) => {
    if (req.user?.role !== "admin") return res.status(403).json({ success: false, message: "Administrator access required" });
    next();
};
