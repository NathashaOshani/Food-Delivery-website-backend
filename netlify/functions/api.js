import serverless from "serverless-http";
import app from "../../server.js";
import { connectDB } from "../../config/db.js";
import { validateEnvironment } from "../../config/env.js";

let ready;
const initialize = async () => {
    validateEnvironment();
    await connectDB();
};

export const handler = async (event, context) => {
    ready ||= initialize();
    await ready;
    return serverless(app)(event, context);
};
