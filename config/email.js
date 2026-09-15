import nodemailer from "nodemailer";

const emailProvider = () => process.env.EMAIL_PROVIDER || "resend";
const emailConfigured = () => Boolean(process.env.EMAIL_FROM && (emailProvider() === "gmail"
    ? process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "")
    : emailProvider() === "brevo" ? process.env.BREVO_API_KEY
    : emailProvider() === "resend" && process.env.RESEND_API_KEY));

const senderDetails = () => {
    const value = process.env.EMAIL_FROM?.trim() || "";
    const match = value.match(/^(.*?)\s*<([^<>]+)>$/);
    return match ? { name: match[1].trim(), email: match[2].trim() } : { email: value };
};

const gmailTransport = () => nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "") },
    connectionTimeout: 10000,
    dnsTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
});

// Checks SMTP authentication without sending a message.
const verifyEmailConnection = async () => {
    if (emailProvider() === "brevo") {
        if (!emailConfigured()) throw new Error("Configure BREVO_API_KEY and EMAIL_FROM first");
        const response = await fetch("https://api.brevo.com/v3/senders", { headers: { "api-key": process.env.BREVO_API_KEY }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`Brevo connection check failed (${response.status})`);
        const { senders = [] } = await response.json();
        if (!senders.some((sender) => sender.email.toLowerCase() === senderDetails().email.toLowerCase() && sender.active)) throw new Error("Verify EMAIL_FROM as an active sender in Brevo first");
        return true;
    }
    if (emailProvider() !== "gmail") throw new Error("Set EMAIL_PROVIDER=gmail to check Gmail SMTP");
    if (!emailConfigured()) throw new Error("Configure EMAIL_FROM, GMAIL_USER, and GMAIL_APP_PASSWORD first");
    return gmailTransport().verify();
};

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

const emailLayout = (subject, content) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#fff6ef;color:#293142;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(subject)} — an update from your Food account.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff6ef;"><tr><td align="center" style="padding:36px 16px;">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;">
<tr><td style="padding:0 0 24px;text-align:center;font-size:30px;font-weight:bold;color:#cf4228;">Food<span style="color:#293142;">.</span></td></tr>
<tr><td style="background:#ffffff;border-top:4px solid #e65b3d;border-radius:16px;padding:32px 28px;">
<p style="margin:0 0 12px;color:#a5422d;font-size:11px;font-weight:bold;letter-spacing:2px;">YOUR FOOD ACCOUNT</p>
<h1 style="margin:0 0 24px;font-size:28px;line-height:1.25;color:#253044;">${escapeHtml(subject)}</h1>
<div style="font-size:15px;line-height:1.8;color:#535e6d;">${content}</div>
</td></tr><tr><td style="padding:24px 20px;text-align:center;font-size:12px;line-height:1.7;color:#72747b;">Good food. A little less hassle.<br>This is an automated message from Food.</td></tr>
</table></td></tr></table></body></html>`;

const actionLink = (url, label) => `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0;"><tr><td bgcolor="#cf4228" style="border-radius:8px;text-align:center;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:15px 24px;border:1px solid #cf4228;border-radius:8px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>
<p style="font-size:12px;line-height:1.6;color:#747b87;">Button not working? Copy this link into your browser:<br><a href="${escapeHtml(url)}" style="color:#b23b24;word-break:break-all;overflow-wrap:anywhere;">${escapeHtml(url)}</a></p>`;

const sendEmail = async ({ to, subject, html }) => {
    if (!emailConfigured()) return false;
    if (emailProvider() === "gmail") {
        await gmailTransport().sendMail({ from: process.env.EMAIL_FROM, to, subject, html: emailLayout(subject, html) });
        return true;
    }
    if (emailProvider() === "brevo") {
        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST", signal: AbortSignal.timeout(20000),
            headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ sender: senderDetails(), to: [{ email: to }], subject, htmlContent: emailLayout(subject, html) }),
        });
        if (!response.ok) throw new Error(`Brevo rejected the email (${response.status})`);
        return true;
    }
    const response = await fetch("https://api.resend.com/emails", {
        signal: AbortSignal.timeout(20000),
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html: emailLayout(subject, html) }),
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
    return sendEmail({ to: email, subject: "Verify your Food account", html: `<p>Hello ${escapeHtml(name)},</p><p>Your next favourite meal is waiting. Confirm your email address to activate your Food account.</p>${actionLink(verificationUrl, "Verify email address")}<p style="padding:14px 16px;background:#fff6ef;border-radius:8px;font-size:13px;">This link expires in <strong>24 hours</strong>.</p><p style="font-size:12px;">If you did not create this account, you can ignore this email.</p>` });
};

const sendPasswordResetEmail = async ({ email, name, token }) => {
    if (!emailConfigured()) return false;
    const clientUrl = process.env.CLIENT_URL?.split(",")[0]?.trim() || "http://localhost:5173";
    const resetUrl = `${clientUrl}/reset-password?token=${encodeURIComponent(token)}`;
    return sendEmail({ to: email, subject: "Reset your Food password", html: `<p>Hello ${escapeHtml(name)},</p><p>A fresh start is one click away. Choose a new password to get back into your Food account.</p>${actionLink(resetUrl, "Reset password")}<p style="padding:14px 16px;background:#fff6ef;border-radius:8px;font-size:13px;">This single-use link expires in <strong>30 minutes</strong>.</p><p style="font-size:12px;">Did not request a reset? You can ignore this email. Your password stays the same until you choose a new one.</p>` });
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
        html: `<p>Hello ${escapeHtml(address.firstName || "customer")},</p><p>${escapeHtml(introduction)}</p><p><strong>Order:</strong> #${escapeHtml(String(order._id))}</p><ul>${items}</ul><p><strong>Total:</strong> Rs. ${escapeHtml(Number(order.amount).toFixed(2))}</p><p><strong>Delivery:</strong> ${escapeHtml([address.street, address.city, address.state, address.zipCode, address.country].filter(Boolean).join(", "))}</p><p><strong>Status:</strong> ${escapeHtml(order.status)}</p>${refund}`,
    });
};

export { emailConfigured, sendOrderNotificationEmail, sendPasswordResetEmail, sendVerificationEmail, verifyEmailConnection };
