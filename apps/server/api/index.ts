/**
 * Vercel Functions entrypoint for @ega/server (production target).
 *
 * The Vercel Hono framework preset expects the Hono application itself as
 * the module default export. `src/serve.ts` remains the long-lived local/dev
 * runtime (@hono/node-server). Both wrap the SAME `createProductionApp()`, so
 * routing, bearer auth, /health and /ready behave identically.
 */
import { createProductionApp } from "../src/app";

const app = createProductionApp();

export default app;
