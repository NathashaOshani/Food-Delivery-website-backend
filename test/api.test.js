import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";

const serverFile = fileURLToPath(new URL("../server.js", import.meta.url));
let apiUrl;
let serverProcess;
let testDirectory;
const webhookSecret = "whsec_integration_test_secret";

const availablePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForServer = (process) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("API did not start in time")), 30000);
  const onData = (chunk) => {
    if (chunk.toString().includes("Server started")) {
      clearTimeout(timeout);
      process.stdout.off("data", onData);
      resolve();
    }
  };
  process.stdout.on("data", onData);
  process.once("exit", (code) => {
    clearTimeout(timeout);
    reject(new Error(`API exited before startup with code ${code}`));
  });
});

const request = async (url, { token, body, ...options } = {}) => {
  const response = await fetch(`${apiUrl}${url}`, {
    ...options,
    headers: {
      ...(body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return { response, data };
};

before(async () => {
  testDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "food-api-test-"));
  await fs.mkdir(path.join(testDirectory, "uploads"));
  const port = await availablePort();
  apiUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [serverFile], {
    cwd: testDirectory,
    env: { ...process.env, PORT: String(port), DB_MODE: "local", JWT_SECRET: "integration-test-secret-with-sufficient-length", CLIENT_URL: "http://localhost:5173", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: webhookSecret },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  serverProcess.stderr.on("data", (chunk) => { errors += chunk; });
  try { await waitForServer(serverProcess); }
  catch (error) { throw new Error(`${error.message}\n${errors}`); }
});

after(async () => {
  if (serverProcess?.exitCode === null) {
    await new Promise((resolve) => {
      serverProcess.once("exit", resolve);
      serverProcess.kill();
    });
  }
  if (testDirectory) await fs.rm(testDirectory, { recursive: true, force: true });
});

test("complete customer and administrator API flow", async () => {
  let result = await request("/");
  assert.equal(result.response.status, 200);
  result = await request("/health/live");
  assert.equal(result.response.status, 200);
  result = await request("/health/ready");
  assert.equal(result.data.database, "connected");

  result = await request("/api/user/register", { method: "POST", body: { name: "Test User", email: "test@example.com", password: "weak" } });
  assert.equal(result.response.status, 400);
  result = await request("/api/user/register", { method: "POST", body: { name: "Test User", email: "test@example.com", password: "password1", role: "admin" } });
  assert.equal(result.response.status, 400);

  result = await request("/api/user/register", { method: "POST", body: { name: "Test User", email: "TEST@example.com", password: "password1" } });
  assert.equal(result.response.status, 201);
  const token = result.data.token;
  const userId = result.data.user.id;
  assert.ok(token);
  assert.equal(result.data.user.emailVerified, true);

  result = await request("/api/user/verify-email", { method: "POST", body: { token: "invalid" } });
  assert.equal(result.response.status, 400);
  result = await request("/api/user/resend-verification", { method: "POST", body: { email: "test@example.com" } });
  assert.equal(result.response.status, 200);

  result = await request("/api/user/register", { method: "POST", body: { name: "Duplicate", email: "test@example.com", password: "password1" } });
  assert.equal(result.response.status, 409);

  result = await request("/api/user/login", { method: "POST", body: { email: "test@example.com", password: "incorrect1" } });
  assert.equal(result.response.status, 401);

  result = await request("/api/user/me");
  assert.equal(result.response.status, 401);
  result = await request("/api/user/me", { token });
  assert.equal(result.data.user.email, "test@example.com");

  result = await request("/api/order/list", { token });
  assert.equal(result.response.status, 403);

  const databaseFile = path.join(testDirectory, "data", "local-db.json");
  result = await request("/api/category/add", { method: "POST", body: { name: "Pizza" } });
  assert.equal(result.response.status, 401);
  result = await request("/api/category/add", { method: "POST", token, body: { name: "Pizza" } });
  assert.equal(result.response.status, 403);
  const database = JSON.parse(await fs.readFile(databaseFile, "utf8"));
  database.users.find((user) => user._id === userId).role = "admin";
  await fs.writeFile(databaseFile, JSON.stringify(database, null, 2));

  result = await request("/api/category/add", { method: "POST", token, body: { name: " Pizza " } });
  assert.equal(result.response.status, 201);
  assert.equal(result.data.data.name, "Pizza");
  for (const name of ["pizza", "PASTA", "All"]) {
    result = await request("/api/category/add", { method: "POST", token, body: { name } });
    assert.equal(result.response.status, 409);
  }
  for (const name of [" ", "x".repeat(51), 123]) {
    result = await request("/api/category/add", { method: "POST", token, body: { name } });
    assert.equal(result.response.status, 400);
  }
  result = await request("/api/category/list");
  assert.ok(result.data.data.some(({ name }) => name === "Pizza"));
  assert.ok(result.data.data.some(({ name }) => name === "Pasta"));
  assert.equal(JSON.parse(await fs.readFile(databaseFile, "utf8")).categories[0].name, "Pizza");

  const invalidImageForm = new FormData();
  invalidImageForm.append("name", "Invalid image"); invalidImageForm.append("description", "Not really an image");
  invalidImageForm.append("price", "10"); invalidImageForm.append("category", "Pasta");
  invalidImageForm.append("image", new Blob(["not an image"], { type: "image/png" }), "fake.png");
  result = await request("/api/food/add", { method: "POST", token, body: invalidImageForm });
  assert.equal(result.response.status, 400);

  const form = new FormData();
  form.append("name", "Integration Pizza");
  form.append("description", "A test menu item");
  form.append("price", "12.50");
  form.append("category", "pizza");
  form.append("stock", "3");
  form.append("isAvailable", "true");
  form.append("image", new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }), "pizza.png");
  result = await request("/api/food/add", { method: "POST", token, body: form });
  assert.equal(result.response.status, 201);
  const foodId = result.data.data._id;
  assert.equal(result.data.data.category, "Pizza");
  result = await request("/api/food/list?category=Pizza");
  assert.equal(result.data.data[0]._id, foodId);

  result = await request(`/api/user/favorites/${foodId}`, { method: "POST", token });
  assert.equal(result.response.status, 200);
  result = await request(`/api/user/favorites/${foodId}`, { method: "POST", token });
  assert.equal(result.response.status, 200);
  result = await request("/api/user/favorites?page=1&limit=5", { token });
  assert.equal(result.data.pagination.total, 1);
  assert.equal(result.data.data[0]._id, foodId);
  result = await request(`/api/user/favorites/${foodId}`, { method: "DELETE", token });
  assert.equal(result.response.status, 200);
  result = await request("/api/user/favorites", { token });
  assert.equal(result.data.pagination.total, 0);
  result = await request(`/api/user/favorites/${foodId}`, { method: "POST", token });
  assert.equal(result.response.status, 200);

  const couponBody = { code: "SAVE10", description: "Ten percent off", type: "percentage", value: 10, minimumOrder: 10, startsAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), usageLimit: 10, perCustomerLimit: 1, isActive: true };
  result = await request("/api/coupon", { method: "POST", token, body: couponBody });
  assert.equal(result.response.status, 201);
  const couponId = result.data.data._id;
  result = await request("/api/coupon/validate", { method: "POST", token, body: { code: "save10", subtotal: 27 } });
  assert.equal(result.data.data.discount, 2.7);
  result = await request(`/api/coupon/${couponId}`, { method: "PUT", token, body: { ...couponBody, description: "Ten percent discount" } });
  assert.equal(result.response.status, 200);

  const updateForm = new FormData();
  updateForm.append("name", "Updated Integration Pizza");
  updateForm.append("description", "An updated test menu item");
  updateForm.append("price", "13.50");
  updateForm.append("category", "Pasta");
  result = await request(`/api/food/${foodId}`, { method: "PUT", token, body: updateForm });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.data.name, "Updated Integration Pizza");
  assert.equal(result.data.data.price, 13.5);
  assert.equal(result.data.data.stock, 3);

  result = await request("/api/food/list");
  assert.equal(result.data.data.find((food) => food._id === foodId).name, "Updated Integration Pizza");

  result = await request("/api/food/list?search=updated&category=Pasta&sort=price_desc&page=1&limit=1");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.data[0]._id, foodId);
  assert.deepEqual(result.data.pagination, { page: 1, limit: 1, total: 1, pages: 1 });
  result = await request("/api/food/list?limit=101");
  assert.equal(result.response.status, 400);
  result = await request("/api/food/list?unexpected=true");
  assert.equal(result.response.status, 400);

  for (const quantity of [0, -1, 1.5, 100, "2", null]) {
    result = await request("/api/cart/add", { method: "POST", token, body: { itemId: foodId, quantity } });
    assert.equal(result.response.status, 400);
  }
  result = await request("/api/cart/add", { method: "POST", token, body: { itemId: foodId, quantity: 2 } });
  assert.equal(result.data.cartData[foodId], 2);
  result = await request("/api/cart/add", { method: "POST", token, body: { itemId: foodId, quantity: 2 } });
  assert.equal(result.response.status, 409);
  result = await request("/api/cart/remove", { method: "POST", token, body: { itemId: foodId } });
  assert.equal(result.data.cartData[foodId], 1);
  result = await request("/api/cart/add", { method: "POST", token, body: { itemId: foodId } });
  assert.equal(result.data.cartData[foodId], 2);

  const address = { firstName: "Test", lastName: "User", email: "test@example.com", street: "1 Main Street", city: "Colombo", state: "Western", zipCode: "00100", country: "Sri Lanka", phone: "+94 771234567" };
  result = await request("/api/user/profile", { method: "PATCH", token, body: { name: "Updated User" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.user.name, "Updated User");
  result = await request("/api/user/addresses", { method: "POST", token, body: { label: "Home", ...address, isDefault: true } });
  assert.equal(result.response.status, 201);
  const addressId = result.data.data._id;
  result = await request("/api/user/addresses", { token });
  assert.equal(result.data.data[0].isDefault, true);
  result = await request(`/api/user/addresses/${addressId}`, { method: "PUT", token, body: { label: "Primary home", ...address, isDefault: true } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.data.label, "Primary home");
  result = await request(`/api/user/addresses/${addressId}`, { method: "DELETE", token });
  assert.equal(result.response.status, 200);
  result = await request("/api/user/addresses", { token });
  assert.equal(result.data.data.length, 0);
  result = await request("/api/order/place", { method: "POST", token, body: { items: [{ itemId: foodId, quantity: 2 }], address, amount: 1 } });
  assert.equal(result.response.status, 400);
  const idempotencyHeaders = { "Idempotency-Key": "checkout-test-001" };
  result = await request("/api/order/place", { method: "POST", token, headers: idempotencyHeaders, body: { items: [{ itemId: foodId, quantity: 2 }], address, couponCode: "SAVE10" } });
  assert.equal(result.response.status, 201);
  assert.equal(result.data.paymentRequired, false);
  const orderId = result.data.orderId;
  result = await request("/api/order/place", { method: "POST", token, headers: idempotencyHeaders, body: { items: [{ itemId: foodId, quantity: 2 }], address, couponCode: "SAVE10" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.orderId, orderId);
  assert.equal(result.data.repeated, true);
  result = await request("/api/coupon/validate", { method: "POST", token, body: { code: "SAVE10", subtotal: 27 } });
  assert.equal(result.response.status, 409);
  result = await request("/api/order/place", { method: "POST", token, headers: idempotencyHeaders, body: { items: [{ itemId: foodId, quantity: 1 }], address } });
  assert.equal(result.response.status, 409);

  result = await request("/api/cart/get", { method: "POST", token });
  assert.deepEqual(result.data.cartData, {});
  result = await request("/api/order/userorders", { token });
  assert.equal(result.data.data[0]._id, orderId);
  assert.equal(result.data.pagination.page, 1);
  assert.equal(result.data.data[0].amount, 26.3);
  assert.equal(result.data.data[0].discount, 2.7);
  result = await request("/api/food/list");
  assert.equal(result.data.data.find((food) => food._id === foodId).stock, 1);
  result = await request("/api/order/place", { method: "POST", token, body: { items: [{ itemId: foodId, quantity: 2 }], address } });
  assert.equal(result.response.status, 400);
  assert.match(result.data.message, /Only 1/);

  const updatedDatabase = JSON.parse(await fs.readFile(databaseFile, "utf8"));
  const stripeOrder = updatedDatabase.orders.find((order) => order._id === orderId);
  stripeOrder.paymentMethod = "stripe";
  stripeOrder.stripeSessionId = "cs_test_integration";
  await fs.writeFile(databaseFile, JSON.stringify(updatedDatabase, null, 2));

  const event = JSON.stringify({ id: "evt_test_completed", type: "checkout.session.completed", data: { object: { id: "cs_test_integration", payment_intent: "pi_test_integration", payment_status: "paid", metadata: { orderId } } } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: event, secret: webhookSecret });
  let webhookResponse = await fetch(`${apiUrl}/api/order/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body: event });
  assert.equal(webhookResponse.status, 200);
  result = await request("/api/order/userorders", { token });
  assert.equal(result.data.data[0].payment, true);
  assert.equal(result.data.data[0].stripeLastEventId, "evt_test_completed");

  // Re-delivery and a late expiration cannot undo an already-paid order.
  webhookResponse = await fetch(`${apiUrl}/api/order/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body: event });
  assert.equal(webhookResponse.status, 200);
  const expiredEvent = JSON.stringify({ id: "evt_test_expired", type: "checkout.session.expired", data: { object: { id: "cs_test_integration" } } });
  const expiredSignature = Stripe.webhooks.generateTestHeaderString({ payload: expiredEvent, secret: webhookSecret });
  webhookResponse = await fetch(`${apiUrl}/api/order/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": expiredSignature }, body: expiredEvent });
  assert.equal(webhookResponse.status, 200);
  result = await request("/api/order/userorders", { token });
  assert.equal(result.data.data[0].status, "Food Processing");

  webhookResponse = await fetch(`${apiUrl}/api/order/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": "invalid" }, body: event });
  assert.equal(webhookResponse.status, 400);

  result = await request("/api/order/status", { method: "POST", token, body: { orderId, status: "Out for delivery" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.data.status, "Out for delivery");
  result = await request(`/api/food/${foodId}/reviews`, { method: "POST", token, body: { rating: 5, comment: "Too early" } });
  assert.equal(result.response.status, 403);

  result = await request("/api/order/status", { method: "POST", token, body: { orderId, status: "Delivered" } });
  assert.equal(result.response.status, 200);
  result = await request(`/api/food/${foodId}/reviews`, { method: "POST", token, body: { rating: 5, comment: "Excellent food" } });
  assert.equal(result.response.status, 201);
  const reviewId = result.data.data.id;
  result = await request(`/api/food/${foodId}/reviews`, { method: "POST", token, body: { rating: 4, comment: "Duplicate" } });
  assert.equal(result.response.status, 409);
  result = await request(`/api/food/${foodId}/reviews`);
  assert.equal(result.data.pagination.total, 1);
  result = await request(`/api/food/${foodId}/reviews/${reviewId}`, { method: "PUT", token, body: { rating: 4, comment: "Very good" } });
  assert.equal(result.data.data.rating, 4);
  result = await request("/api/food/list");
  assert.equal(result.data.data.find((food) => food._id === foodId).ratingAverage, 4);
  result = await request(`/api/food/${foodId}/reviews/${reviewId}/moderate`, { method: "PATCH", token, body: { isVisible: false } });
  assert.equal(result.response.status, 200);
  result = await request(`/api/food/${foodId}/reviews`);
  assert.equal(result.data.pagination.total, 0);
  result = await request(`/api/food/${foodId}/reviews/${reviewId}/moderate`, { method: "PATCH", token, body: { isVisible: true } });
  assert.equal(result.response.status, 200);
  result = await request(`/api/food/${foodId}/reviews/${reviewId}`, { method: "DELETE", token });
  assert.equal(result.response.status, 200);
  result = await request("/api/food/list");
  assert.equal(result.data.data.find((food) => food._id === foodId).ratingCount, 0);

  result = await request(`/api/order/${orderId}/cancel`, { method: "PATCH", token });
  assert.equal(result.response.status, 409);

  result = await request("/api/coupon", { method: "POST", token, body: { code: "FIXED5", type: "fixed", value: 5, startsAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), usageLimit: 1, perCustomerLimit: 1, isActive: true } });
  assert.equal(result.response.status, 201);
  result = await request("/api/order/place", { method: "POST", token, body: { items: [{ itemId: foodId, quantity: 1 }], address, couponCode: "FIXED5" } });
  assert.equal(result.response.status, 201);
  const cancellableOrderId = result.data.orderId;
  result = await request(`/api/order/${cancellableOrderId}/cancel`, { method: "PATCH", token });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.data.status, "Cancelled");
  result = await request("/api/coupon/validate", { method: "POST", token, body: { code: "FIXED5", subtotal: 13.5 } });
  assert.equal(result.response.status, 200);
  result = await request("/api/food/list");
  assert.equal(result.data.data.find((food) => food._id === foodId).stock, 1);
  result = await request(`/api/order/${cancellableOrderId}/cancel`, { method: "PATCH", token });
  assert.equal(result.response.status, 409);
  result = await request("/api/order/status", { method: "POST", token, body: { orderId: cancellableOrderId, status: "Food Processing" } });
  assert.equal(result.response.status, 409);

  const refundDatabase = JSON.parse(await fs.readFile(databaseFile, "utf8"));
  const refundOrder = refundDatabase.orders.find((order) => order._id === cancellableOrderId);
  refundOrder.stripeRefundId = "re_test_integration"; refundOrder.refundStatus = "pending";
  await fs.writeFile(databaseFile, JSON.stringify(refundDatabase, null, 2));
  const refundEvent = JSON.stringify({ id: "evt_refund_updated", type: "refund.updated", data: { object: { id: "re_test_integration", status: "succeeded", created: Math.floor(Date.now() / 1000), metadata: { orderId: cancellableOrderId } } } });
  const refundSignature = Stripe.webhooks.generateTestHeaderString({ payload: refundEvent, secret: webhookSecret });
  webhookResponse = await fetch(`${apiUrl}/api/order/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": refundSignature }, body: refundEvent });
  assert.equal(webhookResponse.status, 200);
  result = await request("/api/order/userorders", { token });
  assert.equal(result.data.data.find((order) => order._id === cancellableOrderId).refundStatus, "succeeded");

  const countedForm = new FormData();
  countedForm.append("name", "Updated Integration Pizza"); countedForm.append("description", "An updated test menu item");
  countedForm.append("price", "13.50"); countedForm.append("category", "Pasta");
  countedForm.append("stock", "2"); countedForm.append("isAvailable", "true");
  result = await request(`/api/food/${foodId}`, { method: "PUT", token, body: countedForm });
  assert.equal(result.response.status, 200);
  const duplicateOrders = await Promise.all([
    request("/api/order/place", { method: "POST", token, headers: { "Idempotency-Key": "concurrent-checkout-001" }, body: { items: [{ itemId: foodId, quantity: 1 }], address } }),
    request("/api/order/place", { method: "POST", token, headers: { "Idempotency-Key": "concurrent-checkout-001" }, body: { items: [{ itemId: foodId, quantity: 1 }], address } }),
  ]);
  assert.deepEqual(duplicateOrders.map(({ response }) => response.status).sort(), [200, 201]);
  assert.equal(duplicateOrders[0].data.orderId, duplicateOrders[1].data.orderId);
  const concurrentOrders = await Promise.all([
    request("/api/order/place", { method: "POST", token, body: { items: [{ itemId: foodId, quantity: 1 }], address } }),
    request("/api/order/place", { method: "POST", token, body: { items: [{ itemId: foodId, quantity: 1 }], address } }),
  ]);
  assert.deepEqual(concurrentOrders.map(({ response }) => response.status).sort(), [201, 400]);

  const unavailableForm = new FormData();
  unavailableForm.append("name", "Updated Integration Pizza"); unavailableForm.append("description", "An updated test menu item");
  unavailableForm.append("price", "13.50"); unavailableForm.append("category", "Pasta");
  unavailableForm.append("stock", "1"); unavailableForm.append("isAvailable", "false");
  result = await request(`/api/food/${foodId}`, { method: "PUT", token, body: unavailableForm });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.data.isAvailable, false);
  result = await request("/api/cart/add", { method: "POST", token, body: { itemId: foodId } });
  assert.equal(result.response.status, 409);
  result = await request("/api/order/place", { method: "POST", token, body: { items: [{ itemId: foodId, quantity: 1 }], address } });
  assert.equal(result.response.status, 400);
  assert.match(result.data.message, /unavailable/);

  result = await request("/api/food/remove", { method: "POST", token, body: { id: foodId } });
  assert.equal(result.response.status, 200);
  result = await request("/api/user/favorites", { token });
  assert.equal(result.data.pagination.total, 0);
  result = await request("/api/not-a-route");
  assert.equal(result.response.status, 404);

  const resetToken = "a".repeat(64);
  const resetDatabase = JSON.parse(await fs.readFile(databaseFile, "utf8"));
  const resetUser = resetDatabase.users.find((user) => user._id === userId);
  resetUser.passwordResetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
  resetUser.passwordResetExpires = new Date(Date.now() + 60000).toISOString();
  await fs.writeFile(databaseFile, JSON.stringify(resetDatabase, null, 2));
  result = await request("/api/user/reset-password", { method: "POST", body: { token: resetToken, password: "newpassword2" } });
  assert.equal(result.response.status, 200);
  result = await request("/api/user/me", { token });
  assert.equal(result.response.status, 401);
  result = await request("/api/user/login", { method: "POST", body: { email: "test@example.com", password: "password1" } });
  assert.equal(result.response.status, 401);
  result = await request("/api/user/login", { method: "POST", body: { email: "test@example.com", password: "newpassword2" } });
  assert.equal(result.response.status, 200);
  result = await request("/api/user/reset-password", { method: "POST", body: { token: resetToken, password: "anotherpassword3" } });
  assert.equal(result.response.status, 400);
});

test("order notification email uses the configured provider payload", async () => {
  const previousKey = process.env.RESEND_API_KEY; const previousFrom = process.env.EMAIL_FROM; const previousFetch = globalThis.fetch;
  let captured;
  process.env.RESEND_API_KEY = "re_test_mock"; process.env.EMAIL_FROM = "Food <orders@example.com>";
  globalThis.fetch = async (url, options) => { captured = { url, ...options, body: JSON.parse(options.body) }; return { ok: true }; };
  try {
    const { sendOrderNotificationEmail } = await import("../config/email.js");
    const sent = await sendOrderNotificationEmail({ _id: "507f1f77bcf86cd799439011", items: [{ name: "Pasta", quantity: 2 }], amount: 25, status: "Food Processing", address: { firstName: "Test", email: "customer@example.com", street: "1 Main Street", city: "Colombo", state: "Western", zipCode: "00100", country: "Sri Lanka" } }, "placed");
    assert.equal(sent, true); assert.equal(captured.url, "https://api.resend.com/emails");
    assert.deepEqual(captured.body.to, ["customer@example.com"]); assert.match(captured.body.subject, /Order received/); assert.match(captured.body.html, /Pasta/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = previousFrom;
  }
});
