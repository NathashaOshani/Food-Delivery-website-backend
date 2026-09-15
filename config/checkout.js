// Inventory may be released only after Stripe confirms the session is expired.
export const settleCheckout = async (stripe, sessionId) => {
    let session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid") return { state: "paid", session };
    if (session.status === "open") {
        try { session = await stripe.checkout.sessions.expire(sessionId); }
        catch {
            // Payment can win the race with expiration. Re-read before deciding.
            session = await stripe.checkout.sessions.retrieve(sessionId);
        }
    }
    return { state: session.payment_status === "paid" ? "paid" : session.status === "expired" ? "expired" : "pending", session };
};
