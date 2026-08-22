import { serve } from "@hono/node-server";

import { createProductionApp } from "./app";
import type { SupabaseEnv } from "./env";

const DEFAULT_PORT = 3001;

export function resolveServerPort(rawPort: string | undefined, fallback = DEFAULT_PORT): number {
  if (rawPort === undefined || rawPort.trim() === "") return fallback;

  const value = Number(rawPort);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(
      `PORT must be an integer between 1 and 65535, received "${rawPort}".`,
    );
  }
  return value;
}

export function validateSupabaseEnv(env: Partial<SupabaseEnv>): void {
  if (!env.url || !/^https?:\/\//.test(env.url)) {
    throw new Error("SUPABASE_URL must be a valid http(s) URL.");
  }
  if (!env.anonKey) {
    throw new Error("SUPABASE_ANON_KEY must not be empty.");
  }
}

export function startServer(): void {
  const port = resolveServerPort(process.env.PORT);
  const app = createProductionApp();

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`@ega/server listening on http://localhost:${info.port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[ega-server] ${signal} received, draining connections...`);

    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();

    server.close((error) => {
      if (error) {
        console.error("[ega-server] error during shutdown", error);
        process.exit(1);
        return;
      }
      console.log("[ega-server] shutdown complete");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");

if (invokedDirectly) {
  startServer();
}
