import type { Context } from "hono";
import { Hono } from "hono";
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
