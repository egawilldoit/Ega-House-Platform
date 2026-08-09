import type { Context } from "hono";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { createAuthenticatedActor, type AuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAuthenticatedClient, extractBearerToken, verifyAccessToken } from "./auth";
import { getSupabaseEnv } from "./env";
import { createGoalsRoutes } from "./routes/goals";
import { createProjectsRoutes } from "./routes/projects";

/**
 * Transport dependencies. Everything the routes need is injected so the
 * transport can be exercised with a fake token verifier and a fake/controlled
 * Supabase client in tests. Production wiring is provided by
 * `createProductionApp`.
 */
export type ServerDependencies = {
  /** Verify a bearer token server-side; resolves to the verified user id or null. */
  verifyToken: (token: string) => Promise<string | null>;
  /** Build the request-scoped Supabase client that carries the SAME token. */
  createRequestClient: (token: string) => SupabaseClient;
  /** Clock injection for deterministic tests; defaults to `new Date()`. */
  now?: () => Date;
};

export type ServerVariables = {
  actor: AuthenticatedActor;
  client: SupabaseClient;
};

export const UNAUTHENTICATED_RESPONSE = {
  error: { code: "UNAUTHENTICATED", message: "Authentication required." },
} as const;

/**
 * Parse the request body strictly as a JSON object. Returns null when the
 * body is absent, not valid JSON, or not a plain object — the transport then
 * answers 400 instead of crashing the handler.
 */
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

      // The actor identity ALWAYS comes from the verified token — never from
      // the request body, URL, query string, or a custom user-id header.
      c.set("actor", createAuthenticatedActor(userId));
      c.set("client", dependencies.createRequestClient(token));

      await next();
    }),
  );

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/api/projects", createProjectsRoutes(dependencies));
  app.route("/api/goals", createGoalsRoutes(dependencies));

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

/**
 * Production wiring: read Supabase credentials from the environment, verify
 * bearer tokens server-side with `auth.getUser`, and build the request-scoped
 * client carrying the verified token for PostgREST/RLS.
 */
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
  });
}
