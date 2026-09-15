import orderModel from "../models/orderModel.js";
import { emailConfigured, sendOrderNotificationEmail } from "./email.js";
import crypto from "node:crypto";

export const deliverOrderNotifications = async (orderId) => {
    if (!emailConfigured()) return;
    const lock = crypto.randomUUID();
    const order = await orderModel.findOneAndUpdate({ _id: orderId, notificationLeaseUntil: { $lt: new Date() } },
        { notificationLeaseUntil: new Date(Date.now() + 5 * 60_000), notificationLeaseToken: lock }, { new: true });
    if (!order) return;
    try {
        for (const key of order.notificationPendingKeys || []) {
            if (!await sendOrderNotificationEmail(order, key)) break;
            await orderModel.findOneAndUpdate({ _id: orderId, notificationLeaseToken: lock }, {
                $pull: { notificationPendingKeys: key }, $addToSet: { notificationKeys: key },
                $push: { notificationLog: { key, createdAt: new Date() } },
            });
        }
    } catch (error) { console.error("Order email delivery failed; queued for retry:", error.code || error.name); }
    finally {
        await orderModel.findOneAndUpdate({ _id: orderId, notificationLeaseToken: lock }, { notificationLeaseUntil: new Date(0), notificationLeaseToken: "" });
    }
};

export const notifyOrder = async (order, key) => {
    try {
        const queued = await orderModel.findOneAndUpdate({ _id: order._id, notificationKeys: { $ne: key } }, {
            $addToSet: { notificationPendingKeys: key },
        }, { new: true });
        // Older orders predate the lease field.
        if (queued) await orderModel.findOneAndUpdate({ _id: order._id, notificationLeaseUntil: { $exists: false } }, { notificationLeaseUntil: new Date(0) });
    } catch (error) { console.error("Unable to queue order email:", error.message); }
};

export const retryOrderNotifications = async () => {
    if (!emailConfigured()) return;
    const orders = await orderModel.find({ "notificationPendingKeys.0": { $exists: true } });
    for (const order of orders) await deliverOrderNotifications(order._id);
};
