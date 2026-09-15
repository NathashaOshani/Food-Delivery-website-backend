import mongoose from "mongoose";

const foodSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    price: { type: Number, required: true, min: 0.01 },
    variants: { type: [new mongoose.Schema({
        id: { type: String, required: true, match: /^[a-f0-9]{24}$/ },
        name: { type: String, required: true, trim: true, maxlength: 40 },
        price: { type: Number, required: true, min: 0.01, max: 100000 },
    }, { _id: false })], default: [] },
    designOptions: { type: [new mongoose.Schema({
        designId: { type: String, required: true, enum: ["blue-teddy", "pink-teddy", "strawberry", "chocolate-drip"] },
        variants: { type: [new mongoose.Schema({
            id: { type: String, required: true, match: /^[a-f0-9]{24}$/ },
            name: { type: String, required: true, trim: true, maxlength: 40 },
            price: { type: Number, required: true, min: 0.01, max: 100000 },
        }, { _id: false })], required: true },
    }, { _id: false })], default: [] },
    image: { type: String, required: true },
    category: { type: String, required: true, trim: true, maxlength: 50 },
    isAvailable: { type: Boolean, default: true, index: true },
    stock: { type: Number, min: 0, default: null },
    ratingAverage: { type: Number, min: 0, max: 5, default: 0 },
    ratingCount: { type: Number, min: 0, default: 0 },
}, { timestamps: true });

const foodModel = process.env.DB_MODE === "local"
    ? (await import("../config/localModels.js")).foodModel
    : mongoose.models.food || mongoose.model("food", foodSchema);

if (process.env.DB_MODE !== "local") {
    foodModel.reserveInventory = async (items) => {
        const reserved = [];
        try {
            for (const item of items) {
                const food = await foodModel.findOne({ _id: item.food, isAvailable: { $ne: false } });
                if (!food) throw new Error(`${item.name} is currently unavailable`);
                if (food.stock !== null && food.stock !== undefined) {
                    const updated = await foodModel.findOneAndUpdate(
                        { _id: item.food, isAvailable: { $ne: false }, stock: { $gte: item.quantity } },
                        { $inc: { stock: -item.quantity } }, { new: true },
                    );
                    if (!updated) throw new Error(`Only ${food.stock} of ${item.name} are available`);
                    reserved.push(item);
                }
            }
            return reserved.map((item) => String(item.food));
        } catch (error) {
            await Promise.all(reserved.map((item) => foodModel.updateOne({ _id: item.food }, { $inc: { stock: item.quantity } })));
            throw error;
        }
    };
    foodModel.releaseInventory = async (items, trackedIds = []) => {
        const tracked = new Set(trackedIds.map(String));
        await Promise.all(items.filter((item) => tracked.has(String(item.food))).map((item) => foodModel.updateOne({ _id: item.food }, { $inc: { stock: item.quantity } })));
    };
}

export default foodModel;
