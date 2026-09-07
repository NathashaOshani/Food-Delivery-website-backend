const foodCategories = ["Salad", "Rolls", "Deserts", "Sandwich", "Cake", "Pure Veg", "Pasta", "Noodles"];
import validator from "validator";

const addressFields = ["firstName", "lastName", "email", "street", "city", "state", "zipCode", "country", "phone"];

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOnlyFields = (value, allowed) => isPlainObject(value) && Object.keys(value).every((key) => allowed.includes(key));
const byteLength = (value) => Buffer.byteLength(value, "utf8");
const boundedString = (value, min, max) => typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
const canonicalCategory = (value) => foodCategories.find((category) => category.toLowerCase() === value?.trim().toLowerCase());

const normalizeAddress = (value = {}) => {
    if (!hasOnlyFields(value, addressFields)) throw new Error("Delivery information contains unknown fields");
    const address = Object.fromEntries(addressFields.map((field) => [field, typeof value[field] === "string" ? value[field].trim() : ""]));
    if (addressFields.some((field) => !address[field])) throw new Error("Complete all delivery information fields");
    if (address.firstName.length < 2 || address.firstName.length > 80 || address.lastName.length < 2 || address.lastName.length > 80) throw new Error("Delivery names must be between 2 and 80 characters");
    if (!validator.isEmail(address.email) || address.email.length > 254) throw new Error("Enter a valid delivery email");
    if (address.street.length < 3 || address.street.length > 150) throw new Error("Street must be between 3 and 150 characters");
    if (["city", "state", "country"].some((field) => address[field].length < 2 || address[field].length > 80)) throw new Error("City, state, and country must be between 2 and 80 characters");
    if (!/^[\p{L}\d][\p{L}\d\s-]{1,19}$/u.test(address.zipCode)) throw new Error("Enter a valid postal code");
    if (!/^[+\d][\d\s().-]{6,19}$/.test(address.phone)) throw new Error("Enter a valid phone number");
    return address;
};

const createRateLimiter = ({ windowMs, max }) => {
    const clients = new Map();
    return (req, res, next) => {
        const now = Date.now();
        const key = req.ip || req.socket.remoteAddress || "unknown";
        const current = clients.get(key);
        const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
        entry.count += 1;
        clients.set(key, entry);
        res.setHeader("RateLimit-Limit", max);
        res.setHeader("RateLimit-Remaining", Math.max(0, max - entry.count));
        res.setHeader("RateLimit-Reset", Math.ceil(entry.resetAt / 1000));
        if (entry.count > max) return res.status(429).json({ success: false, message: "Too many requests. Please try again later." });
        if (clients.size > 10000) for (const [client, value] of clients) if (value.resetAt <= now) clients.delete(client);
        next();
    };
};

export { addressFields, boundedString, byteLength, canonicalCategory, createRateLimiter, foodCategories, hasOnlyFields, isPlainObject, normalizeAddress };
