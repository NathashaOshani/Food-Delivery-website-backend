import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const mongoUri = process.env.MONGODB_TEST_URI;
const serverFile = fileURLToPath(new URL("../server.js", import.meta.url));
const freePort = () => new Promise((resolve, reject) => {
    const socket = net.createServer(); socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => { const { port } = socket.address(); socket.close((error) => error ? reject(error) : resolve(port)); });
});

test("MongoDB-backed API smoke test", { skip: !mongoUri }, async () => {
    const databaseName = new URL(mongoUri).pathname.slice(1).split("?")[0];
    assert.match(databaseName, /test/i, "MONGODB_TEST_URI must name a disposable test database");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "food-api-mongo-test-"));
    await fs.mkdir(path.join(directory, "uploads"));
    const port = await freePort();
    const child = spawn(process.execPath, [serverFile], { cwd: directory, env: { ...process.env, PORT: String(port), DB_MODE: "", MONGODB_URI: mongoUri, JWT_SECRET: "mongo-integration-test-secret-is-long-enough", CLIENT_URL: "http://localhost:5173", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" }, stdio: ["ignore", "pipe", "pipe"] });
    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Mongo API did not start")), 30_000);
            child.stdout.on("data", (chunk) => { if (chunk.toString().includes("server_started")) { clearTimeout(timeout); resolve(); } });
            child.once("exit", (code) => reject(new Error(`Mongo API exited with ${code}`)));
        });
        let response = await fetch(`http://127.0.0.1:${port}/health/ready`);
        assert.equal(response.status, 200);
        response = await fetch(`http://127.0.0.1:${port}/api/user/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Mongo Test", email: "mongo-test@example.com", password: "password1" }) });
        assert.equal(response.status, 201);
    } finally {
        if (child.exitCode === null) child.kill();
        await mongoose.connect(mongoUri); await mongoose.connection.dropDatabase(); await mongoose.disconnect();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
