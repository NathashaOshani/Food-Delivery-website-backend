const serverless = require("serverless-http");

let appPromise;
let ready;

const loadApp = async () => {
    const [{ default: app }, { connectDB }, { validateEnvironment }] = await Promise.all([
        import("../../server.js"),
        import("../../config/db.js"),
        import("../../config/env.js"),
    ]);
    return { app, connectDB, validateEnvironment };
};

const initialize = async () => {
    const { connectDB, validateEnvironment } = await loadApp();
    validateEnvironment();
    await connectDB();
};

exports.handler = async (event, context) => {
    appPromise ||= loadApp();
    ready ||= initialize();
    const [{ app }] = await Promise.all([appPromise, ready]);
    return serverless(app)(event, context);
};
