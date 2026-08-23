/**
 * Vercel Functions entrypoint for @ega/server (production target).
 *
 * This module is what Vercel deploys; `src/serve.ts` remains the long-lived
 * local/dev runtime (@hono/node-server). Both wrap the SAME
 * `createProductionApp()`, so routing, bearer auth, /health and /ready behave
 * identically across the two runtimes.
 *
 * Lifecycle differences are real: Vercel Functions scale to zero and are
 * recycled by the platform, so the SIGTERM drain in serve.ts has no
 * equivalent here, and env vars must be injected as Vercel project
 * environment variables (see docs/architecture/hono-deployment.md).
 */
import { handle } from "hono/vercel";

import { createProductionApp } from "../src/app";

export const runtime = "nodejs";

const app = createProductionApp();

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
