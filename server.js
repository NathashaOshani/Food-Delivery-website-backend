import "dotenv/config";
import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { connectDB, isDatabaseReady } from "./config/db.js";
import foodRouter from "./routes/foodRoute.js";
import userRouter from "./routes/userRoute.js";
import cartRouter from "./routes/cartRoute.js";
import orderRouter from "./routes/orderRoute.js";
import couponRouter from "./routes/couponRoute.js";
import categoryRouter from "./routes/categoryRoute.js";
import { cleanupAbandonedOrders, stripeWebhook } from "./controllers/orderController.js";
import openapiSpecification from "./config/openapi.js";
import { validateEnvironment } from "./config/env.js";
import { logger } from "./config/logger.js";
import { retryOrderNotifications } from "./config/orderNotifications.js";
import { serveMongoImage } from "./config/imageStorage.js";

const app = express();
const port = Number(process.env.PORT) || 4000;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientOrigins = process.env.CLIENT_URL?.split(",").map((origin) => origin.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use((req, res, next) => {
    const startedAt = Date.now();
    req.requestId = req.get("X-Request-Id") || crypto.randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.on("finish", () => logger.info("http_request", { requestId: req.requestId, method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: Date.now() - startedAt }));
    next();
});
app.use(cors({ origin: clientOrigins?.length ? clientOrigins : true }));
app.post("/api/order/webhook", express.raw({ type: "application/json" }), stripeWebhook);
app.use(express.json({ limit: "1mb" }));
app.get("/health/live", (req, res) => res.json({ status: "ok" }));
app.get("/health/ready", (req, res) => res.status(isDatabaseReady() ? 200 : 503).json({ status: isDatabaseReady() ? "ready" : "not_ready", database: isDatabaseReady() ? "connected" : "disconnected" }));
app.get("/uploads/:filename", serveMongoImage);
app.use("/uploads", express.static(path.join(currentDirectory, "uploads")));
app.get("/api-docs.json", (req, res) => res.json(openapiSpecification));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiSpecification, { explorer: true }));
app.use("/api/food", foodRouter);
app.use("/api/user", userRouter);
app.use("/api/cart", cartRouter);
app.use("/api/order", orderRouter);
app.use("/api/coupon", couponRouter);
app.use("/api/category", categoryRouter);
app.get("/", (req, res) => res.json({ success: true, message: "API working", documentation: "/api-docs" }));
app.use("/api", (req, res) => res.status(404).json({ success: false, message: "API endpoint not found" }));

app.use((error, req, res, next) => {
    logger.error("unhandled_request_error", { requestId: req.requestId, error: error.message });
    if (res.headersSent) return next(error);
    const badUpload = error.name === "MulterError" || error.message?.startsWith("Only ");
    const badJson = error instanceof SyntaxError && error.status === 400 && "body" in error;
    res.status(badUpload || badJson ? 400 : 500).json({ success: false, message: badJson ? "Invalid JSON body" : badUpload ? error.message : "Internal server error" });
});

if (process.env.NETLIFY !== "true" && !process.env.AWS_LAMBDA_FUNCTION_NAME) try {
    validateEnvironment();
    await connectDB();
    const retryEmails = () => retryOrderNotifications().catch((error) => logger.error("order_email_retry_failed", { error: error.message }));
    void retryEmails();
    setInterval(retryEmails, 30_000).unref();
    app.listen(port, () => logger.info("server_started", { port, messageText: `Server started on http://localhost:${port}` }));
    if (process.env.STRIPE_SECRET_KEY) {
        const intervalMs = Number(process.env.ORDER_CLEANUP_INTERVAL_MINUTES ?? 15) * 60_000;
        setInterval(() => cleanupAbandonedOrders().then((result) => logger.info("abandoned_order_cleanup", result)).catch((error) => logger.error("abandoned_order_cleanup_failed", { error: error.message })), intervalMs).unref();
    }
} catch (error) {
    logger.error("server_startup_failed", { error: error.message });
    process.exitCode = 1;
}

export default app;
