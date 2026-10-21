import { app } from "./app";
import { config } from "./config";
import { ensureMayor, initDatabase } from "./bootstrap";

await initDatabase();
await ensureMayor();

Bun.serve({ port: config.PORT, fetch: app.fetch, maxRequestBodySize: 8 * 1024 * 1024, idleTimeout: 30 });
console.log(`ROES API listening on http://localhost:${config.PORT}`);
