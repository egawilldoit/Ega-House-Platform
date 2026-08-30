import type { Context } from "hono";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import {
  createAuthenticatedActorFromIdentity,
  type AuthenticatedActor,
} from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createAuthenticatedClient,
  createStatelessClient,
  extractBearerToken,
  verifyAccessToken,
} from "./auth";
import { getSupabaseEnv } from "./env";
import { createAuthRoutes } from "./routes/auth";
import { createFrictionRoutes } from "./routes/friction";
import { createGoalsRoutes } from "./routes/goals";
import { createHealthRoutes } from "./routes/health";
import { createInboxRoutes } from "./routes/inbox";
import { createNotificationsRoutes } from "./routes/notifications";
import { createOperatorRoutes } from "./routes/operator";
import { createProjectsRoutes } from "./routes/projects";
import { createTasksRoutes } from "./routes/tasks";
import { createTimeContextRoutes } from "./routes/time-context";
import { createTimerRoutes } from "./routes/timer";
import { createTodayRoutes } from "./routes/today";
import { createWeeklyReviewRoutes } from "./routes/weekly-review";

export type AuthOutcome =
  | {
      ok: true;
      user?: { id: string; email: string };
      session: { accessToken: string; refreshToken: string; expiresAt: number };
    }
  | { ok: false; message: string };

export type ServerDependencies = {
  /** Verify a bearer token server-side; resolves to the verified user id or null. */
  verifyToken: (token: string) => Promise<string | null>;
  /** Build the request-scoped Supabase client that carries the SAME token. */
  createRequestClient: (token: string) => SupabaseClient;
  /** Exchange email + password for a mobile session payload. */
  authenticateWithPassword?: (email: string, password: string) => Promise<AuthOutcome>;
  /** Exchange a refresh token for a renewed mobile session payload. */
  refreshAuthSession?: (refreshToken: string) => Promise<AuthOutcome>;
  /** Revoke the session that owns the given access token. */
  signOutToken?: (token: string) => Promise<void>;
  /** Dependency probe used by GET /ready; resolves to true when dependencies respond. */
  checkReadiness?: () => Promise<boolean>;
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

const AUTH_PUBLIC_PATHS = new Set(["/api/auth/session", "/api/auth/refresh"]);

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
      if (AUTH_PUBLIC_PATHS.has(c.req.path)) {
        await next();
        return;
      }

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
    if (!dependencies.checkReadiness) return c.json({ status: "ok" });
    const ready = await dependencies.checkReadiness();
    return ready ? c.json({ status: "ok" }) : c.json({ status: "unavailable" }, 503);
  });

  app.route("/api/projects", createProjectsRoutes(dependencies));
  app.route("/api/goals", createGoalsRoutes(dependencies));
  app.route("/api/tasks", createTasksRoutes(dependencies));
  app.route("/api/inbox", createInboxRoutes(dependencies));
  app.route("/api/today", createTodayRoutes(dependencies));
  app.route("/api/timer", createTimerRoutes(dependencies));
  app.route("/api/operator", createOperatorRoutes(dependencies));
  app.route("/api/health", createHealthRoutes(dependencies));
  app.route("/api/friction", createFrictionRoutes(dependencies));
  app.route("/api/time-context", createTimeContextRoutes(dependencies));
  app.route("/api/notifications", createNotificationsRoutes());
  app.route("/api/review", createWeeklyReviewRoutes(dependencies));
  app.route("/api/auth", createAuthRoutes(dependencies));

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

function mapAuthUser(user: { id?: string | null; email?: string | null }): {
  id: string;
  email: string;
} {
  return { id: String(user.id ?? ""), email: user.email ?? "" };
}

function mapSessionPayload(session: {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number | null;
  expires_in?: number | null;
}): { accessToken: string; refreshToken: string; expiresAt: number } | null {
  const accessToken = typeof session.access_token === "string" ? session.access_token : "";
  const refreshToken = typeof session.refresh_token === "string" ? session.refresh_token : "";
  if (!accessToken || !refreshToken) return null;

  const fallbackExpiresAt =
    Math.floor(Date.now() / 1000) + Math.max(0, session.expires_in ?? 3600);

  return {
    accessToken,
    refreshToken,
    expiresAt: session.expires_at ?? fallbackExpiresAt,
  };
}

export function createProductionApp(
  dependencies: Partial<ServerDependencies> = {},
): Hono<{ Variables: ServerVariables }> {
  const env = getSupabaseEnv();
  const stateless = createStatelessClient(env.url, env.anonKey);

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
    authenticateWithPassword:
      dependencies.authenticateWithPassword ??
      (async (email, password) => {
        const { data, error } = await stateless.auth.signInWithPassword({ email, password });
        const session = data.session ? mapSessionPayload(data.session) : null;
        if (error || !session) {
          return { ok: false, message: "Email or password is incorrect." };
        }
        return {
          ok: true,
          user: mapAuthUser(data.user),
          session,
        };
      }),
    refreshAuthSession:
      dependencies.refreshAuthSession ??
      (async (refreshToken) => {
        const { data, error } = await stateless.auth.refreshSession({ refresh_token: refreshToken });
        const session = data.session ? mapSessionPayload(data.session) : null;
        if (error || !session) {
          return { ok: false, message: "Session expired. Sign in again." };
        }
        return {
          ok: true,
          user: data.user ? mapAuthUser(data.user) : undefined,
          session,
        };
      }),
    signOutToken:
      dependencies.signOutToken ??
      (async (token) => {
        const scoped = createAuthenticatedClient(env.url, env.anonKey, token);
        const { error } = await scoped.auth.signOut();
        if (error) throw new Error(`Sign-out failed: ${error.message}`);
      }),
    checkReadiness:
      dependencies.checkReadiness ??
      (async () => {
        const { error } = await stateless.from("projects").select("id").limit(1);
        return !error;
      }),
    now: dependencies.now,
  });
}
