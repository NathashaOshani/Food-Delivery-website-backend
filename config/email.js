const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

const sendEmail = async ({ to, subject, html }) => {
    if (!emailConfigured()) return false;
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
    });
    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Email provider rejected the request (${response.status}): ${details.slice(0, 200)}`);
    }
    return true;
};

const sendVerificationEmail = async ({ email, name, token }) => {
    if (!emailConfigured()) return false;
    const clientUrl = process.env.CLIENT_URL?.split(",")[0]?.trim() || "http://localhost:5173";
    const verificationUrl = `${clientUrl}/verify-email?token=${encodeURIComponent(token)}`;
    return sendEmail({ to: email, subject: "Verify your Food account", html: `<p>Hello ${escapeHtml(name)},</p><p>Welcome to Food. Verify your email address to activate your account.</p><p><a href="${verificationUrl}">Verify email address</a></p><p>This link expires in 24 hours.</p>` });
};

const sendPasswordResetEmail = async ({ email, name, token }) => {
    if (!emailConfigured()) return false;
    const clientUrl = process.env.CLIENT_URL?.split(",")[0]?.trim() || "http://localhost:5173";
    const resetUrl = `${clientUrl}/reset-password?token=${encodeURIComponent(token)}`;
    return sendEmail({ to: email, subject: "Reset your Food password", html: `<p>Hello ${escapeHtml(name)},</p><p>Use the link below to choose a new password.</p><p><a href="${resetUrl}">Reset password</a></p><p>This single-use link expires in 30 minutes. If you did not request it, you can ignore this email.</p>` });
};

const notificationText = {
    placed: ["Order received", "We received your order."],
    "payment-confirmed": ["Payment confirmed", "Your online payment was confirmed."],
    cancelled: ["Order cancelled", "Your order was cancelled."],
    "refund-pending": ["Refund started", "Your refund has started and is pending."],
    "refund-succeeded": ["Refund completed", "Your payment was refunded."],
    "refund-failed": ["Refund needs attention", "Your refund could not be completed automatically. Please contact support."],
};

const sendOrderNotificationEmail = async (order, kind) => {
    const statusText = kind.startsWith("status:") ? `Order status: ${kind.slice(7)}` : null;
    const [subject, introduction] = statusText ? [statusText, `Your order status changed to ${kind.slice(7)}.`] : notificationText[kind] || ["Order update", "Your order was updated."];
    const items = (order.items || []).map((item) => `<li>${escapeHtml(item.name)} × ${Number(item.quantity)}</li>`).join("");
    const address = order.address || {};
    const refund = order.refundStatus ? `<p><strong>Refund:</strong> ${escapeHtml(order.refundStatus)}</p>` : "";
    return sendEmail({
        to: address.email,
        subject: `${subject} · #${String(order._id).slice(-8)}`,
        html: `<p>Hello ${escapeHtml(address.firstName || "customer")},</p><p>${escapeHtml(introduction)}</p><p><strong>Order:</strong> #${escapeHtml(String(order._id))}</p><ul>${items}</ul><p><strong>Total:</strong> ${escapeHtml(String(order.amount))} ${escapeHtml((process.env.CURRENCY || "usd").toUpperCase())}</p><p><strong>Delivery:</strong> ${escapeHtml([address.street, address.city, address.state, address.zipCode, address.country].filter(Boolean).join(", "))}</p><p><strong>Status:</strong> ${escapeHtml(order.status)}</p>${refund}`,
    });
};

export { emailConfigured, sendOrderNotificationEmail, sendPasswordResetEmail, sendVerificationEmail };
