import crypto from "crypto";
import fs from "fs";
import path from "path";

const dataDirectory = path.resolve("data");
const dataFile = path.join(dataDirectory, "local-db.json");
const emptyDatabase = { foods: [], users: [], orders: [], coupons: [], reviews: [], categories: [] };

const readDatabase = () => {
    try { const database = JSON.parse(fs.readFileSync(dataFile, "utf8")); return { ...structuredClone(emptyDatabase), ...database }; }
    catch (error) { if (error.code === "ENOENT") return structuredClone(emptyDatabase); throw error; }
};
const writeDatabase = (database) => {
    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(database, null, 2));
};
const id = () => crypto.randomBytes(12).toString("hex");
const matches = (item, query = {}) => Object.entries(query).every(([key, value]) => {
    if (value && value.$in) return value.$in.map(String).includes(String(item[key]));
    if (value && typeof value === "object" && "$ne" in value) return Array.isArray(item[key]) ? !item[key].map(String).includes(String(value.$ne)) : String(item[key]) !== String(value.$ne);
    if (value && typeof value === "object" && "$lt" in value) return new Date(item[key]).getTime() < new Date(value.$lt).getTime();
    return Array.isArray(item[key]) ? item[key].map(String).includes(String(value)) : String(item[key]) === String(value);
});

class Query {
    constructor(run) { this.run = run; }
    select() { return this; }
    sort(spec) {
        const previous = this.run;
        this.run = async () => {
            const result = await previous();
            if (!Array.isArray(result)) return result;
            const [field, direction] = Object.entries(spec)[0];
            return result.sort((a, b) => direction * String(a[field]).localeCompare(String(b[field])));
        };
        return this;
    }
    skip(count) { const previous = this.run; this.run = async () => (await previous()).slice(count); return this; }
    limit(count) { const previous = this.run; this.run = async () => (await previous()).slice(0, count); return this; }
    then(resolve, reject) { return this.run().then(resolve, reject); }
}

const saveDocument = (collection, document) => {
    document.save = async () => {
        const database = readDatabase();
        const plain = { ...document };
        delete plain.save; delete plain.deleteOne;
        if (plain.cartData instanceof Map) plain.cartData = Object.fromEntries(plain.cartData);
        const index = database[collection].findIndex((item) => item._id === plain._id);
        plain.updatedAt = new Date().toISOString();
        if (index >= 0) database[collection][index] = plain; else database[collection].push(plain);
        writeDatabase(database);
        return document;
    };
    document.deleteOne = async () => {
        const database = readDatabase();
        database[collection] = database[collection].filter((item) => item._id !== document._id);
        writeDatabase(database);
    };
    return document;
};
const hydrateUser = (item) => item && saveDocument("users", { ...item, cartData: new Map(Object.entries(item.cartData || {})) });
const hydrateOrder = (item) => item && saveDocument("orders", { ...item });
const hydrateFood = (item) => item && saveDocument("foods", { ...item });
const hydrateCoupon = (item) => item && saveDocument("coupons", { ...item });
const hydrateReview = (item) => item && saveDocument("reviews", { ...item });

export const categoryModel = {
    find: (query = {}) => new Query(async () => readDatabase().categories.filter((item) => matches(item, query))),
    findOne: (query) => new Query(async () => readDatabase().categories.find((item) => matches(item, query))),
    create: async (values) => {
        const database = readDatabase();
        if (database.categories.some((item) => item.key === values.key)) {
            const error = new Error("Category already exists"); error.code = 11000; throw error;
        }
        const category = { ...values, _id: id(), createdAt: new Date().toISOString() };
        database.categories.push(category); writeDatabase(database); return category;
    },
};

export const foodModel = {
    create: async (values) => {
        for (const field of ["name", "description", "price", "image", "category"]) if (values[field] === undefined || values[field] === "") throw new Error(`${field} is required`);
        const now = new Date().toISOString();
        const food = { ...values, price: Number(values.price), _id: id(), createdAt: now, updatedAt: now };
        const database = readDatabase(); database.foods.push(food); writeDatabase(database); return food;
    },
    find: (query = {}) => new Query(async () => readDatabase().foods.filter((item) => matches(item, query))),
    findById: (foodId) => new Query(async () => hydrateFood(readDatabase().foods.find((item) => item._id === String(foodId)))),
    exists: async (query) => readDatabase().foods.some((item) => matches(item, query)),
    findByIdAndDelete: async (foodId) => {
        const database = readDatabase(); const food = database.foods.find((item) => item._id === String(foodId));
        if (food) { database.foods = database.foods.filter((item) => item._id !== String(foodId)); writeDatabase(database); }
        return food || null;
    },
    reserveInventory: async (items) => {
        const database = readDatabase();
        const trackedIds = [];
        for (const item of items) {
            const food = database.foods.find((entry) => entry._id === String(item.food));
            if (!food || food.isAvailable === false) throw new Error(`${item.name} is currently unavailable`);
            if (food.stock !== null && food.stock !== undefined) {
                const totalQuantity = items.filter((entry) => String(entry.food) === String(item.food)).reduce((total, entry) => total + entry.quantity, 0);
                if (food.stock < totalQuantity) throw new Error(`Only ${food.stock} of ${item.name} are available`);
                trackedIds.push(String(item.food));
            }
        }
        for (const item of items) if (trackedIds.includes(String(item.food))) database.foods.find((entry) => entry._id === String(item.food)).stock -= item.quantity;
        writeDatabase(database);
        return trackedIds;
    },
    releaseInventory: async (items, trackedIds = []) => {
        const database = readDatabase(); const tracked = new Set(trackedIds.map(String));
        for (const item of items) {
            const food = database.foods.find((entry) => entry._id === String(item.food));
            if (food && tracked.has(String(item.food))) food.stock = Number(food.stock) + item.quantity;
        }
        writeDatabase(database);
    },
};

export const userModel = {
    create: async (values) => {
        const now = new Date().toISOString();
        const user = { ...values, role: values.role || "user", cartData: {}, addresses: values.addresses || [], favorites: values.favorites || [], tokenVersion: values.tokenVersion || 0, _id: id(), createdAt: now, updatedAt: now };
        const database = readDatabase(); database.users.push(user); writeDatabase(database); return hydrateUser(user);
    },
    exists: async (query) => readDatabase().users.some((item) => matches(item, query)),
    findOne: (query) => new Query(async () => hydrateUser(readDatabase().users.find((item) => matches(item, query)))),
    findById: (userId) => new Query(async () => hydrateUser(readDatabase().users.find((item) => item._id === String(userId)))),
    findByIdAndUpdate: async (userId, update) => {
        const user = hydrateUser(readDatabase().users.find((item) => item._id === String(userId)));
        if (!user) return null;
        if (update.$addToSet) for (const [field, value] of Object.entries(update.$addToSet)) { user[field] = user[field] || []; if (!user[field].map(String).includes(String(value))) user[field].push(String(value)); }
        if (update.$pull) for (const [field, value] of Object.entries(update.$pull)) user[field] = (user[field] || []).filter((item) => String(item) !== String(value));
        Object.assign(user, Object.fromEntries(Object.entries(update).filter(([key]) => !key.startsWith("$")))); if (update.cartData) user.cartData = new Map(Object.entries(update.cartData));
        return user.save();
    },
    updateMany: async (query, update) => { const database = readDatabase(); let modifiedCount = 0; for (const user of database.users.filter((item) => matches(item, query))) { if (update.$pull) for (const [field, value] of Object.entries(update.$pull)) { const before = (user[field] || []).length; user[field] = (user[field] || []).filter((item) => String(item) !== String(value)); if (user[field].length !== before) modifiedCount += 1; } } writeDatabase(database); return { modifiedCount }; },
    findOneAndUpdate: async (query, update) => {
        const user = hydrateUser(readDatabase().users.find((item) => matches(item, query)));
        if (!user) return null; Object.assign(user, update); await user.save(); return user;
    },
};

export const orderModel = {
    create: async (values) => {
        if (!values.items?.length) throw new Error("Order items are required");
        const requiredAddress = ["firstName", "lastName", "email", "street", "city", "state", "zipCode", "country", "phone"];
        for (const field of requiredAddress) if (!values.address?.[field]) throw new Error(`${field} is required`);
        const database = readDatabase();
        if (values.idempotencyKey && database.orders.some((item) => String(item.userId) === String(values.userId) && item.idempotencyKey === values.idempotencyKey)) {
            const error = new Error("Duplicate idempotency key"); error.code = 11000; throw error;
        }
        const now = new Date().toISOString();
        const order = hydrateOrder({ ...values, inventoryItemIds: values.inventoryItemIds || [], inventoryRestored: false, couponUsageReleased: false, _id: id(), status: "Food Processing", payment: false, createdAt: now, updatedAt: now });
        await order.save(); return order;
    },
    find: (query = {}) => new Query(async () => readDatabase().orders.filter((item) => matches(item, query)).map(hydrateOrder)),
    countDocuments: async (query = {}) => readDatabase().orders.filter((item) => matches(item, query)).length,
    findOne: (query) => new Query(async () => hydrateOrder(readDatabase().orders.find((item) => matches(item, query)))),
    findByIdAndUpdate: async (orderId, update) => {
        const order = hydrateOrder(readDatabase().orders.find((item) => item._id === String(orderId)));
        if (!order) return null; Object.assign(order, update); await order.save(); return order;
    },
    findOneAndUpdate: async (query, update) => {
        const order = hydrateOrder(readDatabase().orders.find((item) => matches(item, query)));
        if (!order) return null;
        if (update.$addToSet) for (const [field, value] of Object.entries(update.$addToSet)) {
            order[field] = order[field] || []; if (!order[field].map(String).includes(String(value))) order[field].push(value);
        }
        if (update.$push) for (const [field, value] of Object.entries(update.$push)) { order[field] = order[field] || []; order[field].push(value); }
        const plainUpdate = Object.fromEntries(Object.entries(update).filter(([key]) => !key.startsWith("$")));
        Object.assign(order, plainUpdate); await order.save(); return order;
    },
};

export const couponModel = {
    create: async (values) => {
        const database = readDatabase();
        if (database.coupons.some((item) => item.code === values.code)) { const error = new Error("Duplicate coupon code"); error.code = 11000; throw error; }
        const now = new Date().toISOString();
        const coupon = hydrateCoupon({ ...values, timesRedeemed: 0, redemptions: [], _id: id(), createdAt: now, updatedAt: now });
        await coupon.save(); return coupon;
    },
    find: (query = {}) => new Query(async () => readDatabase().coupons.filter((item) => matches(item, query)).map(hydrateCoupon)),
    findOne: (query = {}) => new Query(async () => hydrateCoupon(readDatabase().coupons.find((item) => matches(item, query)))),
    findById: (couponId) => new Query(async () => hydrateCoupon(readDatabase().coupons.find((item) => item._id === String(couponId)))),
    findByIdAndDelete: async (couponId) => { const database = readDatabase(); const coupon = database.coupons.find((item) => item._id === String(couponId)); database.coupons = database.coupons.filter((item) => item._id !== String(couponId)); writeDatabase(database); return coupon || null; },
    claim: async ({ code, userId, token, subtotal }) => {
        const database = readDatabase(); const coupon = database.coupons.find((item) => item.code === code);
        if (!coupon) throw new Error("Coupon not found");
        const now = Date.now();
        if (!coupon.isActive || new Date(coupon.startsAt).getTime() > now || new Date(coupon.expiresAt).getTime() <= now) throw new Error("Coupon is not active");
        if (subtotal < coupon.minimumOrder) throw new Error(`Minimum order amount is ${coupon.minimumOrder}`);
        if (coupon.usageLimit !== null && coupon.usageLimit !== undefined && coupon.timesRedeemed >= coupon.usageLimit) throw new Error("Coupon usage limit reached");
        if (coupon.redemptions.filter((item) => item.userId === String(userId)).length >= coupon.perCustomerLimit) throw new Error("Coupon usage limit reached");
        coupon.timesRedeemed += 1; coupon.redemptions.push({ userId: String(userId), token }); writeDatabase(database); return hydrateCoupon(coupon);
    },
    release: async (couponId, token) => {
        const database = readDatabase(); const coupon = database.coupons.find((item) => item._id === String(couponId));
        if (!coupon || !coupon.redemptions.some((item) => item.token === token)) return null;
        coupon.redemptions = coupon.redemptions.filter((item) => item.token !== token); coupon.timesRedeemed = Math.max(0, coupon.timesRedeemed - 1); writeDatabase(database); return hydrateCoupon(coupon);
    },
};

export const reviewModel = {
    create: async (values) => {
        const database = readDatabase();
        if (database.reviews.some((item) => String(item.foodId) === String(values.foodId) && String(item.userId) === String(values.userId))) { const error = new Error("Duplicate review"); error.code = 11000; throw error; }
        const now = new Date().toISOString(); const review = hydrateReview({ ...values, isVisible: values.isVisible ?? true, _id: id(), createdAt: now, updatedAt: now });
        await review.save(); return review;
    },
    find: (query = {}) => new Query(async () => readDatabase().reviews.filter((item) => matches(item, query)).map(hydrateReview)),
    findOne: (query = {}) => new Query(async () => hydrateReview(readDatabase().reviews.find((item) => matches(item, query)))),
    findById: (reviewId) => new Query(async () => hydrateReview(readDatabase().reviews.find((item) => item._id === String(reviewId)))),
    countDocuments: async (query = {}) => readDatabase().reviews.filter((item) => matches(item, query)).length,
    findByIdAndDelete: async (reviewId) => { const database = readDatabase(); const review = database.reviews.find((item) => item._id === String(reviewId)); database.reviews = database.reviews.filter((item) => item._id !== String(reviewId)); writeDatabase(database); return review || null; },
    deleteMany: async (query = {}) => { const database = readDatabase(); const before = database.reviews.length; database.reviews = database.reviews.filter((item) => !matches(item, query)); writeDatabase(database); return { deletedCount: before - database.reviews.length }; },
};
