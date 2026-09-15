import assert from "node:assert/strict";
import { test } from "node:test";
import nodemailer from "nodemailer";
import { emailConfigured, sendPasswordResetEmail, sendVerificationEmail, verifyEmailConnection } from "../config/email.js";
import { validateEnvironment } from "../config/env.js";

test("Gmail sends styled account emails and verifies without sending", async (t) => {
    const keys = ["EMAIL_PROVIDER", "EMAIL_FROM", "GMAIL_USER", "GMAIL_APP_PASSWORD", "CLIENT_URL", "RESEND_API_KEY"];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
    Object.assign(process.env, { EMAIL_PROVIDER: "gmail", EMAIL_FROM: "Food <sender@gmail.com>", GMAIL_USER: "sender@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop", CLIENT_URL: "https://food.example", RESEND_API_KEY: "unused" });
    const sent = [];
    let checked = false;
    t.mock.method(globalThis, "fetch", () => { throw new Error("Gmail must not call Resend"); });
    t.mock.method(nodemailer, "createTransport", (options) => {
        assert.equal(options.service, "gmail");
        assert.equal(options.auth.pass, "abcdefghijklmnop");
        return { sendMail: async (message) => sent.push(message), verify: async () => { checked = true; return true; } };
    });
    assert.equal(emailConfigured(), true);
    await verifyEmailConnection();
    assert.equal(checked, true);
    assert.equal(sent.length, 0);
    await sendPasswordResetEmail({ email: "customer@example.com", name: "<Test>", token: "abc" });
    await sendVerificationEmail({ email: "customer@example.com", name: "Customer", token: "def" });
    assert.equal(sent.length, 2);
    assert.equal(sent[0].to, "customer@example.com");
    assert.match(sent[0].html, /https:\/\/food.example\/reset-password\?token=abc/);
    assert.match(sent[0].html, /&lt;Test&gt;/);
    assert.match(sent[1].html, /verify-email\?token=def/);
    delete process.env.GMAIL_APP_PASSWORD;
    assert.equal(emailConfigured(), false);
    assert.throws(validateEnvironment, /Gmail requires/);
    process.env.GMAIL_APP_PASSWORD = "abcdefghijklmnop";
    process.env.EMAIL_FROM = "Food <onboarding@resend.dev>";
    assert.throws(validateEnvironment, /EMAIL_FROM must use/);
    process.env.EMAIL_PROVIDER = "unknown";
    assert.throws(validateEnvironment, /EMAIL_PROVIDER must be/);
});

test("Gmail authentication errors propagate to the caller", async (t) => {
    const previous = { ...process.env };
    t.after(() => { for (const key of ["EMAIL_PROVIDER", "EMAIL_FROM", "GMAIL_USER", "GMAIL_APP_PASSWORD"]) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
    Object.assign(process.env, { EMAIL_PROVIDER: "gmail", EMAIL_FROM: "Food <sender@gmail.com>", GMAIL_USER: "sender@gmail.com", GMAIL_APP_PASSWORD: "test-password" });
    t.mock.method(nodemailer, "createTransport", () => ({ sendMail: async () => { throw Object.assign(new Error("Authentication failed"), { code: "EAUTH" }); } }));
    await assert.rejects(sendPasswordResetEmail({ email: "customer@example.com", name: "Customer", token: "abc" }), { code: "EAUTH" });
});

test("Brevo uses HTTPS for account emails and verifies the sender without sending", async (t) => {
    const keys = ["EMAIL_PROVIDER", "EMAIL_FROM", "BREVO_API_KEY", "CLIENT_URL"];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
    Object.assign(process.env, { EMAIL_PROVIDER: "brevo", EMAIL_FROM: "DailyDish <sender@example.com>", BREVO_API_KEY: "test-api-key", CLIENT_URL: "https://demo.example" });
    const sent = [];
    t.mock.method(nodemailer, "createTransport", () => { throw new Error("Brevo must not use SMTP"); });
    t.mock.method(globalThis, "fetch", async (url, options) => {
        assert.equal(options.headers["api-key"], "test-api-key");
        if (url.endsWith("/senders")) return { ok: true, json: async () => ({ senders: [{ email: "sender@example.com", active: true }] }) };
        assert.equal(url, "https://api.brevo.com/v3/smtp/email");
        sent.push(JSON.parse(options.body)); return { ok: true };
    });
    assert.equal(emailConfigured(), true); await verifyEmailConnection(); assert.equal(sent.length, 0);
    await sendVerificationEmail({ email: "customer@example.com", name: "<Customer>", token: "abc" });
    assert.deepEqual(sent[0].sender, { name: "DailyDish", email: "sender@example.com" });
    assert.deepEqual(sent[0].to, [{ email: "customer@example.com" }]);
    assert.match(sent[0].htmlContent, /https:\/\/demo.example\/verify-email\?token=abc/);
    assert.match(sent[0].htmlContent, /&lt;Customer&gt;/);
    delete process.env.BREVO_API_KEY; assert.equal(emailConfigured(), false); assert.throws(validateEnvironment, /Brevo requires/);
});

test("Brevo rejection propagates so order notifications can retry", async (t) => {
    const previous = { ...process.env };
    t.after(() => { for (const key of ["EMAIL_PROVIDER", "EMAIL_FROM", "BREVO_API_KEY"]) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
    Object.assign(process.env, { EMAIL_PROVIDER: "brevo", EMAIL_FROM: "sender@example.com", BREVO_API_KEY: "mock" });
    t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 429 }));
    await assert.rejects(sendPasswordResetEmail({ email: "customer@example.com", name: "Test", token: "abc" }), /Brevo rejected the email \(429\)/);
});
