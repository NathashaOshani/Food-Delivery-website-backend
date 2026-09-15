import express from "express";
import { forgotPassword, getCurrentUser, loginUser, loginWithGoogle, registerUser, resendVerification, resetPassword, verifyEmail } from "../controllers/userController.js";
import authMiddleware from "../middleware/auth.js";
import { createRateLimiter } from "../config/validation.js";
import { addAddress, deleteAddress, listAddresses, updateAddress, updateProfile } from "../controllers/profileController.js";
import { addFavorite, listFavorites, removeFavorite } from "../controllers/favoriteController.js";

const userRouter = express.Router();
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
const emailLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
userRouter.post("/register", authLimiter, registerUser);
userRouter.post("/login", authLimiter, loginUser);
userRouter.post("/google", authLimiter, loginWithGoogle);
userRouter.post("/verify-email", emailLimiter, verifyEmail);
userRouter.post("/resend-verification", emailLimiter, resendVerification);
userRouter.post("/forgot-password", emailLimiter, forgotPassword);
userRouter.post("/reset-password", emailLimiter, resetPassword);
userRouter.get("/me", authMiddleware, getCurrentUser);
userRouter.patch("/profile", authMiddleware, updateProfile);
userRouter.get("/addresses", authMiddleware, listAddresses);
userRouter.post("/addresses", authMiddleware, addAddress);
userRouter.put("/addresses/:id", authMiddleware, updateAddress);
userRouter.delete("/addresses/:id", authMiddleware, deleteAddress);
userRouter.get("/favorites", authMiddleware, listFavorites);
userRouter.post("/favorites/:foodId", authMiddleware, addFavorite);
userRouter.delete("/favorites/:foodId", authMiddleware, removeFavorite);

export default userRouter;
