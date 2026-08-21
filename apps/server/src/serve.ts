import { serve } from "@hono/node-server";

import { createProductionApp } from "./app";
import { resolvePort } from "./port";

const port = resolvePort(process.env.PORT);

const app = createProductionApp();

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`@ega/server listening on http://localhost:${info.port}`);
});

const SHUTDOWN_TIMEOUT_MS = 10_000;

function shutdown(signal: string) {
  console.log(`[ega-server] ${signal} received, closing server`);
  const forceExit = setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS);
  server.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
