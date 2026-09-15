import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Stripe from "stripe";
let orders, foods, users, notifications, controller, directory;
const originalCwd = process.cwd();
const originalEnv = { ...process.env };
before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "food-reliability-")); process.chdir(directory);
    process.env.DB_MODE = "local"; process.env.EMAIL_PROVIDER = "resend"; process.env.RESEND_API_KEY = "mock"; process.env.EMAIL_FROM = "Food <test@example.com>"; process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    orders = (await import("../models/orderModel.js")).default;
    foods = (await import("../models/foodmodel.js")).default;
    users = (await import("../models/userModel.js")).default;
    notifications = await import("../config/orderNotifications.js");
    controller = await import("../controllers/orderController.js");
});
after(async () => { process.chdir(originalCwd); await fs.rm(directory, { recursive: true, force: true }); for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } });
const makeOrder = async () => {
    const user = await users.create({ name: "Tester", email: "buyer@example.com" });
    const food = await foods.create({ name: "Pasta", description: "Test food", price: 10, image: "test.png", category: "Pasta", stock: 3 });
    const items = [{ food: food._id, name: food.name, price: 10, image: food.image, quantity: 1 }];
    const inventoryItemIds = await foods.reserveInventory(items);
    return orders.create({ userId: user._id, items, inventoryItemIds, amount: 10, paymentMethod: "stripe", stripeSessionId: `cs_${food._id}`, address: { firstName: "Test", lastName: "Buyer", email: "buyer@example.com", street: "1 Main Street", city: "Colombo", state: "Western", zipCode: "00100", country: "Sri Lanka", phone: "0771234567" } });
};
test("failed email remains queued, retries successfully, and is then deduplicated", async (t) => {
    const order = await makeOrder(); let attempts = 0;
    t.mock.method(globalThis, "fetch", async () => { if (++attempts === 1) throw new Error("Provider unavailable"); return { ok: true }; });
    await notifications.notifyOrder(order, "placed");
    await notifications.deliverOrderNotifications(order._id);
    let stored = await orders.findOne({ _id: order._id });
    assert.deepEqual(stored.notificationPendingKeys, ["placed"]); assert.equal(stored.notificationKeys?.length || 0, 0);
    await Promise.all([notifications.retryOrderNotifications(), notifications.retryOrderNotifications()]);
    stored = await orders.findOne({ _id: order._id });
    assert.deepEqual(stored.notificationKeys, ["placed"]); assert.deepEqual(stored.notificationPendingKeys, []);
    await notifications.notifyOrder(order, "placed"); await notifications.retryOrderNotifications(); assert.equal(attempts, 2);
});
test("verification expires a session, restores stock once, and late payment never reopens it", async (t) => {
    const order = await makeOrder();
    const sessions = Object.getPrototypeOf(new Stripe("sk_test_mock").checkout.sessions);
    let paid = false;
    t.mock.method(sessions, "retrieve", async () => ({ id: order.stripeSessionId, status: paid ? "complete" : "open", payment_status: paid ? "paid" : "unpaid", payment_intent: paid ? "pi_test" : null }));
    t.mock.method(sessions, "expire", async () => ({ status: "expired", payment_status: "unpaid" }));
    const req = { userId: order.userId, body: { orderId: order._id, success: "false" } };
    let res = response(); await controller.verifyOrder(req, res); assert.equal(res.data.cancelled, true);
    assert.equal((await foods.findById(order.items[0].food)).stock, 3);
    res = response(); await controller.verifyOrder(req, res); assert.equal((await foods.findById(order.items[0].food)).stock, 3);
    paid = true; res = response(); await controller.verifyOrder(req, res);
    const stored = await orders.findOne({ _id: order._id });
    assert.equal(stored.status, "Cancelled"); assert.equal(stored.payment, true); assert.equal(stored.paymentReviewRequired, true); assert.equal((await foods.findById(order.items[0].food)).stock, 3);
});
test("cancellation discovers payment before its webhook and starts a refund", async (t) => {
    const order = await makeOrder(); const stripe = new Stripe("sk_test_mock"); let refunded = false;
    t.mock.method(Object.getPrototypeOf(stripe.checkout.sessions), "retrieve", async () => ({ status: "complete", payment_status: "paid", payment_intent: "pi_test" }));
    t.mock.method(Object.getPrototypeOf(stripe.refunds), "create", async () => { refunded = true; return { id: "re_test", status: "succeeded" }; });
    const res = response(); await controller.cancelOrder({ userId: order.userId, params: { id: order._id }, body: {} }, res);
    assert.equal(refunded, true); assert.equal(res.data.data.refundStatus, "succeeded"); assert.equal((await foods.findById(order.items[0].food)).stock, 3);
});
test("admins cannot fulfill an unpaid online order", async () => {
    const order = await makeOrder(); const res = response();
    await controller.updateStatus({ body: { orderId: order._id, status: "Delivered" } }, res);
    assert.equal(res.statusCode, 409); assert.equal((await orders.findOne({ _id: order._id })).status, "Food Processing");
});

test("customer and admin pagination expose orders beyond the first twenty", async () => {
    const template = await makeOrder();
    for (let i = 0; i < 22; i++) await orders.create({ userId: template.userId, items: template.items, address: template.address, paymentMethod: "cash", amount: 10 });
    const first = response(), second = response(), admin = response();
    await controller.userOrders({ userId: template.userId, query: { page: "1" } }, first);
    await controller.userOrders({ userId: template.userId, query: { page: "2" } }, second);
    await controller.listOrders({ query: { page: "2" } }, admin);
    assert.equal(first.data.data.length, 20); assert.equal(second.data.data.length, 3);
    assert.equal(first.data.pagination.pages, 2); assert.equal(new Set([...first.data.data, ...second.data.data].map((order) => order._id)).size, 23);
    assert.ok(admin.data.data.length > 0);
    assert.equal(second.data.data[0].address.street, "1 Main Street"); assert.equal(second.data.data[0].address.phone, "0771234567");
});

test("checkout retry returns the existing order and cancelled attempts require a new key", async (t) => {
    const template = await makeOrder();
    t.mock.method(Object.getPrototypeOf(new Stripe("sk_test_mock").checkout.sessions), "create", async () => ({ id: "cs_retry", url: "https://checkout.example/test" }));
    const req = { userId: template.userId, get: () => "checkout-retry-test", body: { items: [{ itemId: template.items[0].food, quantity: 1 }], address: template.address } };
    const first = response(), second = response(), cancelled = response();
    await controller.placeOrder(req, first);
    assert.equal(first.statusCode, 201);
    await controller.placeOrder(req, second);
    assert.equal(second.data.orderId, first.data.orderId); assert.equal(second.data.repeated, true);
    assert.equal((await foods.findById(template.items[0].food)).stock, 1);
    await orders.findByIdAndUpdate(first.data.orderId, { status: "Cancelled" });
    await controller.placeOrder(req, cancelled);
    assert.equal(cancelled.statusCode, 409); assert.equal(cancelled.data.code, "ORDER_CANCELLED");
});
