import Stripe from "stripe";
import mongoose from "mongoose";
import crypto from "crypto";
import foodModel from "../models/foodmodel.js";
import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";
import couponModel from "../models/couponModel.js";
import { calculateDiscount } from "./couponController.js";
import { hasOnlyFields, isPlainObject, normalizeAddress } from "../config/validation.js";
import { notifyOrder } from "../config/orderNotifications.js";
import { settleCheckout } from "../config/checkout.js";
import { cartKey, selectVariant, selectDesign, cakeDesigns, validVariantId } from "../config/foodOptions.js";

const configuredDeliveryFee = Number(process.env.DELIVERY_FEE ?? 650);
const deliveryFee = Number.isFinite(configuredDeliveryFee) && configuredDeliveryFee >= 0 ? configuredDeliveryFee : 650;
const taxRate = 0.1;
const currency = "lkr";
const maxQuantity = 99;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

const orderResponse = (order, repeated = false) => ({
    success: true, repeated, paymentRequired: order.paymentMethod === "stripe" && !order.payment && order.status !== "Cancelled",
    ...(order.stripeSessionUrl ? { sessionUrl: order.stripeSessionUrl } : {}),
    orderId: order._id,
    message: repeated ? "Existing order returned" : "Order placed",
});

const fingerprintOrder = (items, address, couponCode) => crypto.createHash("sha256").update(JSON.stringify({
    items: items.map((item) => ({ food: String(item.food), quantity: item.quantity, ...(item.variantId ? { variantId: item.variantId } : {}), ...(item.designId ? { designId: item.designId } : {}) })).sort((a, b) => cartKey(a.food, a.variantId, a.designId).localeCompare(cartKey(b.food, b.variantId, b.designId))),
    address, couponCode,
})).digest("hex");

const restoreInventory = async (order) => {
    if (order.inventoryRestored || !order.inventoryItemIds?.length) return;
    const claimed = await orderModel.findOneAndUpdate(
        { _id: order._id, inventoryRestored: false },
        { inventoryRestored: true }, { new: true },
    );
    if (!claimed) return;
    try { await foodModel.releaseInventory(claimed.items, claimed.inventoryItemIds); }
    catch (error) {
        claimed.inventoryRestored = false; await claimed.save().catch(() => {});
        throw error;
    }
};

const restoreCouponUsage = async (order) => {
    if (!order.coupon?.id || !order.couponRedemptionToken || order.couponUsageReleased) return;
    const claimed = await orderModel.findOneAndUpdate({ _id: order._id, couponUsageReleased: false }, { couponUsageReleased: true }, { new: true });
    if (!claimed) return;
    try { await couponModel.release(claimed.coupon.id, claimed.couponRedemptionToken); }
    catch (error) { claimed.couponUsageReleased = false; await claimed.save().catch(() => {}); throw error; }
};

const buildOrderItems = async (requestedItems = []) => {
    if (!Array.isArray(requestedItems) || !requestedItems.length) throw new Error("Your cart is empty");
    if (requestedItems.length > 50) throw new Error("An order cannot contain more than 50 different items");
    const quantities = new Map();
    for (const item of requestedItems) {
        if (!hasOnlyFields(item, ["itemId", "id", "_id", "quantity", "variantId", "designId"])) throw new Error("Cart item contains unknown fields");
        const id = item.itemId || item._id || item.id;
        const quantity = Number(item.quantity);
        if (!mongoose.isValidObjectId(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity) {
            throw new Error("Cart contains an invalid item or quantity");
        }
        if (item.variantId !== undefined && !validVariantId(item.variantId)) throw new Error("Invalid option id");
        if (item.designId !== undefined && !cakeDesigns.some((design) => design.id === item.designId)) throw new Error("Invalid cake design");
        const key = cartKey(String(id), item.variantId, item.designId);
        if (quantities.has(key)) throw new Error("Cart contains a duplicate item");
        quantities.set(key, { id: String(id), variantId: item.variantId, designId: item.designId, quantity });
    }
    const ids = [...new Set([...quantities.values()].map((item) => item.id))];
    const foods = await foodModel.find({ _id: { $in: ids } });
    if (!foods.length || foods.length !== ids.length) throw new Error("One or more food items are unavailable");
    return [...quantities.values()].map((item) => {
        const food = foods.find((entry) => String(entry._id) === item.id);
        const design = selectDesign(food, item.designId);
        const variant = selectVariant(food, item.variantId, item.designId);
        return { food: food._id, name: `${food.name}${variant ? ` (${variant.name})` : ""}${design ? ` - ${design.name}` : ""}`,
            price: variant ? variant.price : food.price, image: food.image, quantity: item.quantity,
            ...(variant ? { variantId: variant.id, variantName: variant.name } : {}),
            ...(design ? { designId: design.id, designName: design.name } : {}) };
    });
};

const placeOrder = async (req, res) => {
    let order;
    let items = [];
    let reservedItems = [];
    let claimedCoupon;
    let couponRedemptionToken;
    try {
        const idempotencyKey = req.get("Idempotency-Key")?.trim();
        if (idempotencyKey && !idempotencyKeyPattern.test(idempotencyKey)) throw new Error("Idempotency-Key must be 8-128 letters, numbers, dots, colons, underscores, or hyphens");
        if (!hasOnlyFields(req.body, ["items", "address", "couponCode"])) throw new Error("Only items, address, and couponCode are allowed");
        items = await buildOrderItems(req.body.items);
        const address = normalizeAddress(req.body.address);
        const couponCode = req.body.couponCode === undefined || req.body.couponCode === "" ? undefined : String(req.body.couponCode).trim().toUpperCase();
        if (couponCode && !/^[A-Z0-9_-]{3,32}$/.test(couponCode)) throw new Error("Invalid coupon code");
        const requestFingerprint = fingerprintOrder(items, address, couponCode);
        if (idempotencyKey) {
            const existing = await orderModel.findOne({ userId: req.userId, idempotencyKey });
            if (existing) {
                if (existing.status === "Cancelled") return res.status(409).json({ success: false, code: "ORDER_CANCELLED", message: "The previous checkout was cancelled. Submit again to start a new order." });
                if (existing.requestFingerprint !== requestFingerprint) return res.status(409).json({ success: false, message: "Idempotency-Key was already used for a different order" });
                if (existing.paymentMethod === "stripe" && !existing.stripeSessionUrl) return res.status(409).json({ success: false, message: "Order creation is still in progress; retry shortly" });
                return res.json(orderResponse(existing, true));
            }
        }
        const subtotal = Number(items.reduce((total, item) => total + item.price * item.quantity, 0).toFixed(2));
        const paymentMethod = process.env.STRIPE_SECRET_KEY ? "stripe" : "cash";
        reservedItems = await foodModel.reserveInventory(items);
        let discount = 0;
        if (couponCode) {
            couponRedemptionToken = crypto.randomUUID();
            claimedCoupon = await couponModel.claim({ code: couponCode, userId: req.userId, token: couponRedemptionToken, subtotal });
            discount = calculateDiscount(claimedCoupon, subtotal);
        }
        const taxAndService = Number(((subtotal - discount + deliveryFee) * taxRate).toFixed(2));
        const amount = Number((subtotal - discount + deliveryFee + taxAndService).toFixed(2));
        try {
            order = await orderModel.create({ userId: req.userId, items, subtotal, deliveryFee, discount, taxAndService, amount, address, paymentMethod, inventoryItemIds: reservedItems, idempotencyKey, requestFingerprint, coupon: claimedCoupon ? { id: claimedCoupon._id, code: claimedCoupon.code, type: claimedCoupon.type, value: claimedCoupon.value } : undefined, couponRedemptionToken });
        } catch (error) {
            if (error.code !== 11000 || !idempotencyKey) throw error;
            await foodModel.releaseInventory(items, reservedItems);
            reservedItems = [];
            if (claimedCoupon) { await couponModel.release(claimedCoupon._id, couponRedemptionToken); claimedCoupon = undefined; }
            const existing = await orderModel.findOne({ userId: req.userId, idempotencyKey });
            if (existing?.status === "Cancelled") return res.status(409).json({ success: false, code: "ORDER_CANCELLED", message: "The previous checkout was cancelled. Submit again to start a new order." });
            if (!existing || existing.requestFingerprint !== requestFingerprint) return res.status(409).json({ success: false, message: "Idempotency-Key was already used for a different order" });
            if (existing.paymentMethod === "stripe" && !existing.stripeSessionUrl) return res.status(409).json({ success: false, message: "Order creation is still in progress; retry shortly" });
            return res.json(orderResponse(existing, true));
        }

        if (!process.env.STRIPE_SECRET_KEY) {
            await userModel.findByIdAndUpdate(req.userId, { cartData: {} });
            await notifyOrder(order, "placed");
            return res.status(201).json(orderResponse(order));
        }

        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const clientUrl = process.env.CLIENT_URL?.split(",")[0] || "http://localhost:5173";
        const lineItems = [{ price_data: { currency, product_data: { name: claimedCoupon ? `Food order (${claimedCoupon.code} applied)` : "Food order" }, unit_amount: Math.round((subtotal - discount) * 100) }, quantity: 1 }];
        lineItems.push({ price_data: { currency, product_data: { name: "Delivery fee" }, unit_amount: Math.round(deliveryFee * 100) }, quantity: 1 });
        lineItems.push({ price_data: { currency, product_data: { name: "Tax & Service (10%)" }, unit_amount: Math.round(taxAndService * 100) }, quantity: 1 });
        const session = await stripe.checkout.sessions.create({
            line_items: lineItems,
            mode: "payment",
            success_url: `${clientUrl}/verify?success=true&orderId=${order._id}`,
            cancel_url: `${clientUrl}/verify?success=false&orderId=${order._id}`,
            metadata: { orderId: String(order._id), userId: String(req.userId) },
        }, idempotencyKey ? { idempotencyKey: `checkout-${req.userId}-${idempotencyKey}` } : undefined);
        order.stripeSessionId = session.id;
        order.stripeSessionUrl = session.url;
        await order.save();
        await notifyOrder(order, "placed");
        res.status(201).json(orderResponse(order));
    } catch (error) {
        const discardedOrder = order && order.stripeSessionId === undefined && process.env.STRIPE_SECRET_KEY;
        if (discardedOrder) await order.deleteOne().catch(() => {});
        if ((!order || discardedOrder) && reservedItems.length) await foodModel.releaseInventory(items, reservedItems).catch(() => {});
        if ((!order || discardedOrder) && claimedCoupon) await couponModel.release(claimedCoupon._id, couponRedemptionToken).catch(() => {});
        res.status(400).json({ success: false, message: error.message || "Unable to place order" });
    }
};

const verifyOrder = async (req, res) => {
    if (!hasOnlyFields(req.body, ["orderId", "success"])) return res.status(400).json({ success: false, message: "Only orderId and success are allowed" });
    if (!mongoose.isValidObjectId(req.body.orderId)) return res.status(400).json({ success: false, message: "A valid order id is required" });
    const order = await orderModel.findOne({ _id: req.body.orderId, userId: req.userId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (!order.stripeSessionId) return res.status(400).json({ success: false, message: "This order does not use online payment" });
    if (order.payment) return res.json({ success: true, paymentVerified: true, message: "Payment already verified" });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ success: false, message: "Stripe is not configured" });

    const { state, session } = await settleCheckout(new Stripe(process.env.STRIPE_SECRET_KEY), order.stripeSessionId);
    if (session.payment_intent && !order.stripePaymentIntentId) order.stripePaymentIntentId = String(session.payment_intent);
    if (session.payment_status === "paid") {
        order.payment = true;
        order.paymentReviewRequired = order.status === "Cancelled";
        await order.save();
        await userModel.findByIdAndUpdate(req.userId, { cartData: {} });
        await notifyOrder(order, "payment-confirmed");
        return res.json({ success: true, paymentVerified: true, message: "Payment verified" });
    }

    if (state !== "expired") return res.json({ success: true, paymentVerified: false, pending: true, message: "Payment is still processing. Check your orders shortly." });
    order.status = "Cancelled";
    await order.save();
    await restoreInventory(order);
    await restoreCouponUsage(order);
    res.json({ success: true, paymentVerified: false, cancelled: true, message: "Payment was not completed" });
};

const paginatedOrders = async (req, res, query) => {
    if (!hasOnlyFields(req.query, ["page", "limit"])) return res.status(400).json({ success: false, message: "Unknown query parameter" });
    const page = Number(req.query.page ?? 1); const limit = Number(req.query.limit ?? 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ success: false, message: "Page must be positive and limit must be between 1 and 100" });
    const total = await orderModel.countDocuments(query);
    const data = await orderModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    res.json({ success: true, data, pagination: { page, limit, total, pages: total ? Math.ceil(total / limit) : 0 } });
};
const userOrders = async (req, res) => paginatedOrders(req, res, { userId: req.userId });
const listOrders = async (req, res) => paginatedOrders(req, res, {});
const updateStatus = async (req, res) => {
    if (!hasOnlyFields(req.body, ["orderId", "status"])) return res.status(400).json({ success: false, message: "Only orderId and status are allowed" });
    const allowed = ["Food Processing", "Out for delivery", "Delivered", "Cancelled"];
    if (!allowed.includes(req.body.status)) return res.status(400).json({ success: false, message: "Invalid order status" });
    if (!mongoose.isValidObjectId(req.body.orderId)) return res.status(400).json({ success: false, message: "A valid order id is required" });
    const order = await orderModel.findOne({ _id: req.body.orderId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (["pending", "succeeded"].includes(order.refundStatus) && req.body.status !== "Cancelled") return res.status(409).json({ success: false, message: "A refunded order must remain cancelled" });
    if ((order.inventoryRestored || order.status === "Cancelled") && req.body.status !== "Cancelled") return res.status(409).json({ success: false, message: "A cancelled order cannot be reopened" });
    if (req.body.status === "Cancelled" && order.paymentMethod === "stripe") {
        return cancelOrder({ ...req, params: { id: String(order._id) }, body: {}, userId: order.userId, isAdminCancellation: true }, res);
    }
    if (order.paymentMethod === "stripe" && !order.payment) return res.status(409).json({ success: false, message: "Wait for confirmed payment before fulfilling this order" });
    order.status = req.body.status; await order.save();
    if (order.status === "Cancelled") await restoreInventory(order);
    if (order.status === "Cancelled") await restoreCouponUsage(order);
    await notifyOrder(order, `status:${order.status}`);
    res.json({ success: true, message: "Status updated", data: order });
};

const cancelOrder = async (req, res) => {
    if (req.body !== undefined && (!isPlainObject(req.body) || Object.keys(req.body).length)) return res.status(400).json({ success: false, message: "Request body must be empty" });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "A valid order id is required" });
    const order = await orderModel.findOne({ _id: req.params.id, userId: req.userId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (order.refundStatus === "pending" || order.refundStatus === "succeeded") return res.json({ success: true, message: order.refundStatus === "succeeded" ? "Order cancelled and refunded" : "Order cancelled; refund pending", data: order });
    if (order.status !== "Food Processing" && !(req.isAdminCancellation && order.status === "Cancelled" && order.paymentReviewRequired)) return res.status(409).json({ success: false, message: "This order can no longer be cancelled" });
    if (order.paymentMethod === "stripe" && !order.payment) {
        if (!process.env.STRIPE_SECRET_KEY || !order.stripeSessionId) return res.status(503).json({ success: false, message: "Payment verification is unavailable; try again shortly" });
        const { state, session } = await settleCheckout(new Stripe(process.env.STRIPE_SECRET_KEY), order.stripeSessionId);
        if (state === "pending") return res.status(409).json({ success: false, message: "Payment is still processing. Please try again shortly." });
        if (state === "paid") { order.payment = true; order.stripePaymentIntentId = session.payment_intent ? String(session.payment_intent) : undefined; await order.save(); }
    }
    if (order.paymentMethod === "stripe" && order.payment) {
        if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ success: false, message: "Stripe is not configured" });
        try {
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
            if (!order.stripePaymentIntentId) {
                if (!order.stripeSessionId) return res.status(409).json({ success: false, message: "Payment reference is unavailable; contact support" });
                const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
                order.stripePaymentIntentId = session.payment_intent ? String(session.payment_intent) : undefined;
            }
            if (!order.stripePaymentIntentId) return res.status(409).json({ success: false, message: "Payment reference is unavailable; contact support" });
            const refund = await stripe.refunds.create({ payment_intent: order.stripePaymentIntentId, reason: "requested_by_customer", metadata: { orderId: String(order._id), userId: String(order.userId) } }, { idempotencyKey: `order-refund-${order._id}` });
            order.stripeRefundId = refund.id;
            order.refundStatus = refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending";
            order.paymentReviewRequired = false;
            order.refundFailureReason = refund.failure_reason || undefined;
            order.refundedAt = refund.status === "succeeded" ? new Date() : undefined;
            order.status = "Cancelled";
            await order.save();
            await restoreInventory(order);
            await restoreCouponUsage(order);
            await notifyOrder(order, `refund-${order.refundStatus}`);
            return res.json({ success: true, message: order.refundStatus === "succeeded" ? "Order cancelled and refunded" : order.refundStatus === "failed" ? "Order cancelled, but the refund needs administrator attention" : "Order cancelled; refund pending", data: order });
        } catch (error) {
            console.error("Stripe refund failed:", error.message);
            return res.status(502).json({ success: false, message: "Refund could not be started. Please try again or contact support." });
        }
    }
    order.status = "Cancelled";
    await order.save();
    await restoreInventory(order);
    await restoreCouponUsage(order);
    await notifyOrder(order, "cancelled");
    res.json({ success: true, message: "Order cancelled", data: order });
};

const getOrderConfig = (req, res) => res.json({ success: true, deliveryFee, taxRate, currency, onlinePaymentEnabled: Boolean(process.env.STRIPE_SECRET_KEY) });

const completeStripeOrder = async (session, eventId) => {
    if (session.payment_status !== "paid") return;
    const order = await orderModel.findOne({ stripeSessionId: session.id });
    if (!order || order.stripeLastEventId === eventId) return;
    if (session.metadata?.orderId && String(order._id) !== session.metadata.orderId) throw new Error("Stripe session order metadata does not match");
    order.payment = true;
    if (session.payment_intent) order.stripePaymentIntentId = String(session.payment_intent);
    if (order.status === "Cancelled" && !order.refundStatus) order.paymentReviewRequired = true;
    order.stripeLastEventId = eventId;
    await order.save();
    await userModel.findByIdAndUpdate(order.userId, { cartData: {} });
    await notifyOrder(order, "payment-confirmed");
};

const updateRefund = async (refund, eventId) => {
    const order = await orderModel.findOne(refund.metadata?.orderId ? { _id: refund.metadata.orderId } : { stripeRefundId: refund.id });
    if (!order || order.refundLastEventId === eventId) return;
    order.stripeRefundId = refund.id;
    order.paymentReviewRequired = false;
    order.refundStatus = refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending";
    order.refundFailureReason = refund.failure_reason || undefined;
    if (refund.payment_intent) order.stripePaymentIntentId = String(refund.payment_intent);
    if (order.refundStatus === "succeeded") order.refundedAt = new Date((refund.created || Math.floor(Date.now() / 1000)) * 1000);
    order.refundLastEventId = eventId;
    order.status = "Cancelled";
    await order.save();
    await restoreInventory(order);
    await restoreCouponUsage(order);
    await notifyOrder(order, `refund-${order.refundStatus}`);
};

const completeChargeRefund = async (charge, eventId) => {
    if (!charge.refunded || !charge.payment_intent) return;
    const order = await orderModel.findOne({ stripePaymentIntentId: String(charge.payment_intent) });
    if (!order || order.refundLastEventId === eventId) return;
    order.refundStatus = "succeeded"; order.refundedAt = new Date(); order.refundLastEventId = eventId; order.status = "Cancelled";
    order.paymentReviewRequired = false;
    await order.save();
    await restoreInventory(order);
    await restoreCouponUsage(order);
    await notifyOrder(order, "refund-succeeded");
};

const expireStripeOrder = async (session, eventId) => {
    const order = await orderModel.findOne({ stripeSessionId: session.id });
    if (!order || order.payment || order.stripeLastEventId === eventId) return;
    order.status = "Cancelled";
    order.stripeLastEventId = eventId;
    await order.save();
    await restoreInventory(order);
    await restoreCouponUsage(order);
    await notifyOrder(order, "cancelled");
};

const stripeWebhook = async (req, res) => {
    if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ success: false, message: "Stripe webhook is not configured" });
    try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_webhook_verification_only");
        const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
        if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
            await completeStripeOrder(event.data.object, event.id);
        } else if (["checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) {
            await expireStripeOrder(event.data.object, event.id);
        } else if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
            await updateRefund(event.data.object, event.id);
        } else if (event.type === "charge.refunded") {
            await completeChargeRefund(event.data.object, event.id);
        }
        res.json({ received: true });
    } catch (error) {
        console.error("Stripe webhook failed:", error.message);
        res.status(400).json({ success: false, message: "Invalid Stripe webhook" });
    }
};

const cleanupAbandonedOrders = async () => {
    if (!process.env.STRIPE_SECRET_KEY) return { checked: 0, expired: 0 };
    const ttlMinutes = Number(process.env.UNPAID_ORDER_TTL_MINUTES ?? 60);
    const cutoff = new Date(Date.now() - ttlMinutes * 60_000);
    const abandoned = await orderModel.find({ paymentMethod: "stripe", payment: false, status: "Food Processing", createdAt: { $lt: cutoff } });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    let expired = 0;
    for (const order of abandoned) {
        if (!order.stripeSessionId) continue;
        try {
            let session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
            if (session.payment_status === "paid") {
                await completeStripeOrder(session, `cleanup-paid-${session.id}`);
                continue;
            }
            if (session.status === "open") session = await stripe.checkout.sessions.expire(session.id);
            if (session.status === "expired") {
                await expireStripeOrder(session, `cleanup-expired-${session.id}`);
                expired += 1;
            }
        } catch (error) { console.error("Abandoned order cleanup failed:", order._id, error.message); }
    }
    return { checked: abandoned.length, expired };
};

export { placeOrder, verifyOrder, userOrders, listOrders, updateStatus, cancelOrder, getOrderConfig, stripeWebhook, cleanupAbandonedOrders };
