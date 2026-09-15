import assert from "node:assert/strict";
import { test } from "node:test";
import { settleCheckout } from "../config/checkout.js";

test("open checkout expires before cancellation can release stock", async () => {
    const calls = [];
    const result = await settleCheckout({ checkout: { sessions: {
        retrieve: async () => { calls.push("retrieve"); return { status: "open", payment_status: "unpaid" }; },
        expire: async () => { calls.push("expire"); return { status: "expired", payment_status: "unpaid" }; },
    } } }, "cs_test");
    assert.deepEqual(calls, ["retrieve", "expire"]); assert.equal(result.state, "expired");
});
test("payment winning the expiration race is treated as paid", async () => {
    let reads = 0;
    const result = await settleCheckout({ checkout: { sessions: {
        retrieve: async () => ++reads === 1 ? { status: "open", payment_status: "unpaid" } : { status: "complete", payment_status: "paid" },
        expire: async () => { throw new Error("Already complete"); },
    } } }, "cs_test");
    assert.equal(result.state, "paid");
});
test("processing payments and failed expiration keep inventory reserved", async () => {
    const sessions = { retrieve: async () => ({ status: "complete", payment_status: "unpaid" }), expire: async () => { throw new Error("Should not expire completed session"); } };
    assert.equal((await settleCheckout({ checkout: { sessions } }, "cs_test")).state, "pending");
    sessions.retrieve = async () => ({ status: "open", payment_status: "unpaid" });
    assert.equal((await settleCheckout({ checkout: { sessions } }, "cs_test")).state, "pending");
});
