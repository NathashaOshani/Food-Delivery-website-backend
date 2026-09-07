const httpUrl = (value) => {
    try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
};

const validateEnvironment = () => {
    const errors = [];
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) errors.push("JWT_SECRET must contain at least 32 characters");
    if (process.env.DB_MODE && process.env.DB_MODE !== "local") errors.push("DB_MODE must be 'local' or omitted");
    if (process.env.PORT && (!Number.isInteger(Number(process.env.PORT)) || Number(process.env.PORT) < 1 || Number(process.env.PORT) > 65535)) errors.push("PORT must be between 1 and 65535");
    if (process.env.DELIVERY_FEE !== undefined && (!Number.isFinite(Number(process.env.DELIVERY_FEE)) || Number(process.env.DELIVERY_FEE) < 0)) errors.push("DELIVERY_FEE must be zero or greater");
    if (process.env.CURRENCY && !/^[a-z]{3}$/i.test(process.env.CURRENCY)) errors.push("CURRENCY must be a three-letter code");
    if (process.env.UNPAID_ORDER_TTL_MINUTES && (!Number.isInteger(Number(process.env.UNPAID_ORDER_TTL_MINUTES)) || Number(process.env.UNPAID_ORDER_TTL_MINUTES) < 30)) errors.push("UNPAID_ORDER_TTL_MINUTES must be an integer of at least 30");
    if (process.env.ORDER_CLEANUP_INTERVAL_MINUTES && (!Number.isInteger(Number(process.env.ORDER_CLEANUP_INTERVAL_MINUTES)) || Number(process.env.ORDER_CLEANUP_INTERVAL_MINUTES) < 1)) errors.push("ORDER_CLEANUP_INTERVAL_MINUTES must be a positive integer");
    for (const origin of process.env.CLIENT_URL?.split(",").map((value) => value.trim()).filter(Boolean) || []) if (!httpUrl(origin)) errors.push(`Invalid CLIENT_URL origin: ${origin}`);
    if (Boolean(process.env.RESEND_API_KEY) !== Boolean(process.env.EMAIL_FROM)) errors.push("RESEND_API_KEY and EMAIL_FROM must be configured together");
    if (process.env.EMAIL_FROM && !/.+<[^<>\s]+@[^<>\s]+>$|^[^<>\s]+@[^<>\s]+$/.test(process.env.EMAIL_FROM.trim())) errors.push("EMAIL_FROM must contain a valid sender email");
    if (errors.length) throw new Error(`Invalid environment configuration: ${errors.join("; ")}`);
};

export { validateEnvironment };
