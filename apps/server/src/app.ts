import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";

import {
  createAuthenticatedActorFromIdentity,
  type AuthenticatedActor,
} from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAuthenticatedClient, extractBearerToken, verifyAccessToken } from "./auth";
import { getSupabaseEnv } from "./env";
import { createGoalsRoutes } from "./routes/goals";
import { createProjectsRoutes } from "./routes/projects";
import { createTasksRoutes } from "./routes/tasks";
import { createTodayRoutes } from "./routes/today";

export type ServerDependencies = {
  /** Verify a bearer token server-side; resolves to the verified user id or null. */
  verifyToken: (token: string) => Promise<string | null>;
  /** Build the request-scoped Supabase client that carries the SAME token. */
  createRequestClient: (token: string) => SupabaseClient;
  /** Clock injection for deterministic tests; defaults to `new Date()`. */
  now?: () => Date;
  /**
   * Readiness probe for GET /ready. Resolves true when the server's
   * dependencies are reachable. When omitted, /ready reports config-ok.
   */
  readinessCheck?: () => Promise<boolean>;
  /**
   * Allowed CORS origins for /api/*. Undefined or empty disables CORS
   * entirely (the default).
   */
  corsOrigins?: string[];
};

export type ServerVariables = {
  actor: AuthenticatedActor;
  client: SupabaseClient;
};

export const UNAUTHENTICATED_RESPONSE = {
  error: { code: "UNAUTHENTICATED", message: "Authentication required." },
} as const;

export async function readJsonBody(
  c: Context,
): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createApp(dependencies: ServerDependencies): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  if (dependencies.corsOrigins && dependencies.corsOrigins.length > 0) {
    app.use("/api/*", cors({ origin: dependencies.corsOrigins }));
  }

  app.use(
    "/api/*",
    createMiddleware<{ Variables: ServerVariables }>(async (c, next) => {
      const token = extractBearerToken(c.req.header("authorization"));

      if (!token) {
        return c.json(UNAUTHENTICATED_RESPONSE, 401);
      }

      const userId = await dependencies.verifyToken(token);

      if (!userId) {
        return c.json(UNAUTHENTICATED_RESPONSE, 401);
      }

      // The identity object is constructed only after bearer verification.
      // Request bodies, query parameters, paths and custom headers cannot
      // select the application actor.
      c.set(
        "actor",
        createAuthenticatedActorFromIdentity({ id: userId }),
      );
      c.set("client", dependencies.createRequestClient(token));

      await next();
    }),
  );

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/ready", async (c) => {
    const check = dependencies.readinessCheck;

    if (!check) {
      return c.json({ status: "ok" });
    }

    const ready = await check();

    if (!ready) {
      return c.json({ status: "unavailable" }, 503);
    }

    return c.json({ status: "ok" });
  });

  app.route("/api/projects", createProjectsRoutes(dependencies));
  app.route("/api/goals", createGoalsRoutes(dependencies));
  app.route("/api/tasks", createTasksRoutes(dependencies));
  app.route("/api/today", createTodayRoutes());

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404),
  );

  app.onError((error, c) => {
    console.error("[ega-server] unhandled error", error);
    return c.json(
      { error: { code: "INTERNAL", message: "Internal server error." } },
      500,
    );
  });

  return app;
}

const READINESS_TIMEOUT_MS = 3_000;

/**
 * Cheap Supabase reachability probe for /ready. Hits the auth service
 * health endpoint with the anon key; no user data is read.
 */
async function pingSupabase(url: string, anonKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(READINESS_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function resolveCorsOrigins(): string[] | undefined {
  const raw = process.env.SERVER_CORS_ORIGINS;

  if (!raw) {
    return undefined;
  }

  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? origins : undefined;
}

export function createProductionApp(
  dependencies: Partial<ServerDependencies> = {},
): Hono<{ Variables: ServerVariables }> {
  const env = getSupabaseEnv();

  return createApp({
    verifyToken:
      dependencies.verifyToken ??
      (async (token) => {
        const client = createAuthenticatedClient(env.url, env.anonKey, token);
        return verifyAccessToken(client, token);
      }),
    createRequestClient:
      dependencies.createRequestClient ??
      ((token) => createAuthenticatedClient(env.url, env.anonKey, token)),
    now: dependencies.now,
    readinessCheck:
      dependencies.readinessCheck ?? (() => pingSupabase(env.url, env.anonKey)),
    corsOrigins: dependencies.corsOrigins ?? resolveCorsOrigins(),
  });
}
