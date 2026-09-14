import "dotenv/config";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/db.js";

// Auditing must not implicitly create collections or indexes.
mongoose.set("autoCreate", false);
mongoose.set("autoIndex", false);

try {
    if (process.env.DB_MODE === "local") throw new Error("Database audit requires MongoDB; DB_MODE is local");
    const models = await Promise.all([
        "../models/userModel.js", "../models/foodmodel.js", "../models/orderModel.js",
        "../models/couponModel.js", "../models/reviewModel.js", "../models/categoryModel.js",
    ].map(async (file) => (await import(file)).default));
    await connectDB();
    const existing = new Set((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));
    const report = { database: mongoose.connection.name, collections: [], issues: 0 };
    for (const model of models) {
        const name = model.collection.collectionName;
        const entry = { name, exists: existing.has(name), documents: 0, missingIndexes: [], invalidDocuments: 0, invalidFields: {} };
        if (entry.exists) {
            entry.documents = await model.collection.countDocuments();
            const indexes = await model.collection.indexes();
            entry.indexes = indexes.map(({ name, key, unique, sparse, partialFilterExpression }) => ({ name, key, unique: Boolean(unique), sparse: Boolean(sparse), partialFilterExpression }));
            entry.missingIndexes = model.schema.indexes().filter(([key, options]) => !indexes.some((index) =>
                JSON.stringify(index.key) === JSON.stringify(key) && Boolean(index.unique) === Boolean(options.unique)
                && Boolean(index.sparse) === Boolean(options.sparse)
                && JSON.stringify(index.partialFilterExpression) === JSON.stringify(options.partialFilterExpression)
            )).map(([key, options]) => ({ key, unique: Boolean(options.unique), sparse: Boolean(options.sparse) }));
            // Report field names only: never print account data or validation values.
            for await (const raw of model.collection.find({})) {
                try {
                    await model.hydrate(raw).validate();
                } catch (error) {
                    if (error.name !== "ValidationError") throw error;
                    entry.invalidDocuments++;
                    for (const field of Object.keys(error.errors)) entry.invalidFields[field] = (entry.invalidFields[field] || 0) + 1;
                }
            }
        }
        report.issues += Number(!entry.exists) + entry.missingIndexes.length + entry.invalidDocuments;
        report.collections.push(entry);
    }
    console.log(JSON.stringify(report, null, 2));
    if (report.issues) process.exitCode = 1;
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    await disconnectDB();
}
