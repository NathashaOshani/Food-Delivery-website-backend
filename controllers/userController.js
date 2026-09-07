import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import validator from "validator";
import userModel from "../models/userModel.js";
import { emailConfigured, sendPasswordResetEmail, sendVerificationEmail } from "../config/email.js";
import { boundedString, byteLength, hasOnlyFields } from "../config/validation.js";

const createToken = (id, tokenVersion = 0) => jwt.sign({ id, v: tokenVersion }, process.env.JWT_SECRET, { expiresIn: "7d" });
const verificationToken = () => {
    const token = crypto.randomBytes(32).toString("hex");
    return { token, hash: crypto.createHash("sha256").update(token).digest("hex"), expires: new Date(Date.now() + 24 * 60 * 60 * 1000) };
};
const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified !== false });

const registerUser = async (req, res) => {
    if (!hasOnlyFields(req.body, ["name", "email", "password"])) return res.status(400).json({ success: false, message: "Only name, email, and password are allowed" });
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body.password;
    if (!process.env.JWT_SECRET) return res.status(500).json({ success: false, message: "JWT_SECRET is not configured" });
    if (!name || !email || !password) return res.status(400).json({ success: false, message: "Name, email, and password are required" });
    if (!boundedString(name, 2, 80) || !/^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u.test(name)) return res.status(400).json({ success: false, message: "Name must be 2-80 characters and contain only letters, spaces, apostrophes, periods, or hyphens" });
    if (email.length > 254) return res.status(400).json({ success: false, message: "Email is too long" });
    if (!validator.isEmail(email)) return res.status(400).json({ success: false, message: "Enter a valid email" });
    if (typeof password !== "string" || byteLength(password) > 72) return res.status(400).json({ success: false, message: "Password must not exceed 72 bytes" });
    if (!validator.isStrongPassword(password, { minLength: 8, minLowercase: 1, minUppercase: 0, minNumbers: 1, minSymbols: 0 })) {
        return res.status(400).json({ success: false, message: "Password must be at least 8 characters and include a number" });
    }
    if (await userModel.exists({ email })) return res.status(409).json({ success: false, message: "An account already exists for this email" });

    const verificationRequired = emailConfigured();
    const verification = verificationRequired ? verificationToken() : null;
    const user = await userModel.create({ name, email, password: await bcrypt.hash(password, 12), emailVerified: !verificationRequired, emailVerificationTokenHash: verification?.hash, emailVerificationExpires: verification?.expires });
    if (verificationRequired) {
        try {
            await sendVerificationEmail({ email, name, token: verification.token });
        } catch (error) {
            console.error("Registration email failed:", error.message);
            return res.status(503).json({ success: false, verificationRequired: true, message: "Account created, but the verification email could not be sent. Please use resend verification." });
        }
        return res.status(201).json({ success: true, verificationRequired: true, message: "Account created. Check your email to verify it before signing in." });
    }
    res.status(201).json({ success: true, verificationRequired: false, token: createToken(user._id, user.tokenVersion), user: publicUser(user) });
};

const loginUser = async (req, res) => {
    if (!hasOnlyFields(req.body, ["email", "password"])) return res.status(400).json({ success: false, message: "Only email and password are allowed" });
    if (!process.env.JWT_SECRET) return res.status(500).json({ success: false, message: "JWT_SECRET is not configured" });
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!validator.isEmail(email) || email.length > 254 || typeof req.body.password !== "string" || byteLength(req.body.password) > 72) return res.status(401).json({ success: false, message: "Invalid email or password" });
    const user = await userModel.findOne({ email }).select("+password");
    if (!user || !(await bcrypt.compare(req.body.password || "", user.password))) {
        return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    if (user.emailVerified === false) return res.status(403).json({ success: false, verificationRequired: true, message: "Verify your email before signing in" });
    res.json({ success: true, token: createToken(user._id, user.tokenVersion), user: publicUser(user) });
};

const getCurrentUser = (req, res) => {
    res.json({ success: true, user: publicUser(req.user) });
};

const verifyEmail = async (req, res) => {
    if (!hasOnlyFields(req.body, ["token"])) return res.status(400).json({ success: false, message: "Only token is allowed" });
    const token = req.body.token;
    if (typeof token !== "string" || !/^[a-f\d]{64}$/i.test(token)) return res.status(400).json({ success: false, message: "Invalid verification link" });
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await userModel.findOne({ emailVerificationTokenHash: hash }).select("+emailVerificationTokenHash +emailVerificationExpires");
    if (!user || !user.emailVerificationExpires || new Date(user.emailVerificationExpires) <= new Date()) {
        return res.status(400).json({ success: false, message: "Verification link is invalid or expired" });
    }
    user.emailVerified = true;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();
    res.json({ success: true, message: "Email verified. You can now sign in." });
};

const resendVerification = async (req, res) => {
    if (!hasOnlyFields(req.body, ["email"])) return res.status(400).json({ success: false, message: "Only email is allowed" });
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const genericResponse = { success: true, message: "If an unverified account exists, a verification email has been sent." };
    if (!validator.isEmail(email) || email.length > 254) return res.status(400).json({ success: false, message: "Enter a valid email" });
    const user = await userModel.findOne({ email });
    if (!user || user.emailVerified !== false) return res.json(genericResponse);
    if (!emailConfigured()) return res.status(503).json({ success: false, message: "Email delivery is not configured" });
    const verification = verificationToken();
    user.emailVerificationTokenHash = verification.hash;
    user.emailVerificationExpires = verification.expires;
    await user.save();
    try {
        await sendVerificationEmail({ email: user.email, name: user.name, token: verification.token });
        res.json(genericResponse);
    } catch (error) {
        console.error("Verification email failed:", error.message);
        res.status(503).json({ success: false, message: "Verification email could not be sent. Please try again later." });
    }
};

const forgotPassword = async (req, res) => {
    if (!hasOnlyFields(req.body, ["email"])) return res.status(400).json({ success: false, message: "Only email is allowed" });
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!validator.isEmail(email) || email.length > 254) return res.status(400).json({ success: false, message: "Enter a valid email" });
    if (!emailConfigured()) return res.status(503).json({ success: false, message: "Email delivery is not configured" });
    const genericResponse = { success: true, message: "If an account exists, a password reset email has been sent." };
    const user = await userModel.findOne({ email });
    if (!user) return res.json(genericResponse);
    const reset = verificationToken();
    reset.expires = new Date(Date.now() + 30 * 60 * 1000);
    user.passwordResetTokenHash = reset.hash;
    user.passwordResetExpires = reset.expires;
    await user.save();
    try {
        await sendPasswordResetEmail({ email: user.email, name: user.name, token: reset.token });
        res.json(genericResponse);
    } catch (error) {
        console.error("Password reset email failed:", error.message);
        res.status(503).json({ success: false, message: "Password reset email could not be sent. Please try again later." });
    }
};

const resetPassword = async (req, res) => {
    if (!hasOnlyFields(req.body, ["token", "password"])) return res.status(400).json({ success: false, message: "Only token and password are allowed" });
    const { token, password } = req.body;
    if (typeof token !== "string" || !/^[a-f\d]{64}$/i.test(token)) return res.status(400).json({ success: false, message: "Invalid password reset link" });
    if (typeof password !== "string" || byteLength(password) > 72 || !validator.isStrongPassword(password, { minLength: 8, minLowercase: 1, minUppercase: 0, minNumbers: 1, minSymbols: 0 })) {
        return res.status(400).json({ success: false, message: "Password must be 8-72 bytes and include a number" });
    }
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await userModel.findOne({ passwordResetTokenHash: hash }).select("+passwordResetTokenHash +passwordResetExpires +password");
    if (!user || !user.passwordResetExpires || new Date(user.passwordResetExpires) <= new Date()) return res.status(400).json({ success: false, message: "Password reset link is invalid or expired" });
    user.password = await bcrypt.hash(password, 12);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpires = undefined;
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    await user.save();
    res.json({ success: true, message: "Password reset successfully. Sign in with your new password." });
};

export { registerUser, loginUser, getCurrentUser, verifyEmail, resendVerification, forgotPassword, resetPassword };
