import "dotenv/config";
import fs from "fs";
import path from "path";
import foodModel from "../models/foodmodel.js";
import { connectDB, disconnectDB } from "../config/db.js";

const groups = [
    ["Salad", ["Greek salad", "Veg salad", "Clover Salad", "Chicken Salad"], [12, 18, 16, 24]],
    ["Rolls", ["Lasagna Rolls", "Peri Peri Rolls", "Chicken Rolls", "Veg Rolls"], [14, 12, 20, 15]],
    ["Deserts", ["Ripple Ice Cream", "Fruit Ice Cream", "Jar Ice Cream", "Vanilla Ice Cream"], [14, 22, 10, 12]],
    ["Sandwich", ["Chicken Sandwich", "Vegan Sandwich", "Grilled Sandwich", "Bread Sandwich"], [12, 18, 16, 24]],
    ["Cake", ["Cup Cake", "Vegan Cake", "Butterscotch Cake", "Sliced Cake"], [14, 12, 20, 15]],
    ["Pure Veg", ["Garlic Mushroom", "Fried Cauliflower", "Mix Veg Pulao", "Rice Zucchini"], [14, 22, 10, 12]],
    ["Pasta", ["Cheese Pasta", "Tomato Pasta", "Creamy Pasta", "Chicken Pasta"], [12, 18, 16, 24]],
    ["Noodles", ["Butter Noodles", "Veg Noodles", "Somen Noodles", "Cooked Noodles"], [14, 12, 20, 15]],
];

try {
    await connectDB();
    const existing = await foodModel.find({});
    if (existing.length) {
        console.log(`Catalog already contains ${existing.length} foods; nothing was changed.`);
    } else {
        let imageNumber = 1;
        for (const [category, names, prices] of groups) {
            for (let index = 0; index < names.length; index += 1) {
                const image = `food_${imageNumber}.png`;
                const source = path.resolve("assets", image);
                const destination = path.resolve("uploads", image);
                if (!fs.existsSync(destination)) await fs.promises.copyFile(source, destination);
                await foodModel.create({ name: names[index], price: prices[index], category, image, description: "Food provides essential nutrients for overall health and well-being" });
                imageNumber += 1;
            }
        }
        console.log("Seeded 32 food items.");
    }
} catch (error) {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
} finally {
    await disconnectDB();
}
