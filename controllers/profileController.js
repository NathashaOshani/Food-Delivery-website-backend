import mongoose from "mongoose";
import userModel from "../models/userModel.js";
import { addressFields, boundedString, hasOnlyFields, normalizeAddress } from "../config/validation.js";

const getUser = (id) => userModel.findById(id);
const addressPayload = (body) => {
    if (!hasOnlyFields(body, ["label", "isDefault", ...addressFields])) throw new Error("Saved address contains unknown fields");
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (label.length < 1 || label.length > 50) throw new Error("Address label must be between 1 and 50 characters");
    if (body.isDefault !== undefined && typeof body.isDefault !== "boolean") throw new Error("isDefault must be true or false");
    return { label, ...normalizeAddress(Object.fromEntries(addressFields.map((field) => [field, body[field]]))), isDefault: Boolean(body.isDefault) };
};
const addressesOf = (user) => user.addresses || [];

const updateProfile = async (req, res) => {
    if (!hasOnlyFields(req.body, ["name"])) return res.status(400).json({ success: false, message: "Only name is allowed" });
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!boundedString(name, 2, 80) || !/^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u.test(name)) return res.status(400).json({ success: false, message: "Name must be 2-80 valid characters" });
    const user = await getUser(req.userId);
    user.name = name; await user.save();
    res.json({ success: true, message: "Profile updated", user: { id: user._id, name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified !== false } });
};

const listAddresses = async (req, res) => {
    const user = await getUser(req.userId);
    res.json({ success: true, data: addressesOf(user) });
};

const addAddress = async (req, res) => {
    try {
        const user = await getUser(req.userId);
        const addresses = addressesOf(user);
        if (addresses.length >= 10) return res.status(400).json({ success: false, message: "You can save up to 10 addresses" });
        const address = { _id: new mongoose.Types.ObjectId(), ...addressPayload(req.body) };
        if (!addresses.length) address.isDefault = true;
        if (address.isDefault) addresses.forEach((item) => { item.isDefault = false; });
        addresses.push(address); user.addresses = addresses; await user.save();
        res.status(201).json({ success: true, message: "Address saved", data: address });
    } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

const updateAddress = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "A valid address id is required" });
    try {
        const user = await getUser(req.userId); const addresses = addressesOf(user);
        const address = addresses.find((item) => String(item._id) === req.params.id);
        if (!address) return res.status(404).json({ success: false, message: "Address not found" });
        const update = addressPayload(req.body);
        if (update.isDefault) addresses.forEach((item) => { item.isDefault = false; });
        else if (address.isDefault) update.isDefault = true;
        Object.assign(address, update); user.addresses = addresses; await user.save();
        res.json({ success: true, message: "Address updated", data: address });
    } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

const deleteAddress = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "A valid address id is required" });
    const user = await getUser(req.userId); const addresses = addressesOf(user);
    const index = addresses.findIndex((item) => String(item._id) === req.params.id);
    if (index < 0) return res.status(404).json({ success: false, message: "Address not found" });
    const [removed] = addresses.splice(index, 1);
    if (removed.isDefault && addresses.length) addresses[0].isDefault = true;
    user.addresses = addresses; await user.save();
    res.json({ success: true, message: "Address deleted" });
};

export { addAddress, deleteAddress, listAddresses, updateAddress, updateProfile };
