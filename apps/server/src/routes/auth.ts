import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { AuthOutcome, ServerDependencies, ServerVariables } from "../app";
import { extractBearerToken } from "../auth";
import { readJsonBody } from "../app";

function mobileError(
  c: import("hono").Context,
  code: string,
  message: string,
  status: ContentfulStatusCode,
) {
  return c.json({ ok: false as const, error: { code, message } }, status);
}

export function createAuthRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.post("/session", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return mobileError(c, "VALIDATION_ERROR", "Request body must be valid JSON.", 400);

    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      return mobileError(c, "VALIDATION_ERROR", "Email and password are required.", 400);
    }
    if (!dependencies.authenticateWithPassword) {
      return mobileError(c, "INTERNAL_ERROR", "Authentication is not configured.", 500);
    }

    const outcome: AuthOutcome = await dependencies.authenticateWithPassword(email, password);
    if (!outcome.ok) return mobileError(c, "INVALID_CREDENTIALS", outcome.message, 401);

    return c.json({ ok: true as const, user: outcome.user, session: outcome.session });
  });

  routes.post("/refresh", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return mobileError(c, "VALIDATION_ERROR", "Request body must be valid JSON.", 400);

    const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
    if (!refreshToken) {
      return mobileError(c, "VALIDATION_ERROR", "Refresh token is required.", 400);
    }
    if (!dependencies.refreshAuthSession) {
      return mobileError(c, "INTERNAL_ERROR", "Authentication is not configured.", 500);
    }

    const outcome: AuthOutcome = await dependencies.refreshAuthSession(refreshToken);
    if (!outcome.ok) return mobileError(c, "SESSION_EXPIRED", outcome.message, 401);

    return c.json({
      ok: true as const,
      session: outcome.session,
      user: outcome.user,
    });
  });

  routes.post("/logout", async (c) => {
    const token = extractBearerToken(c.req.header("authorization"));
    if (!token) return mobileError(c, "UNAUTHENTICATED", "Authentication required.", 401);
    if (!dependencies.signOutToken) {
      return mobileError(c, "INTERNAL_ERROR", "Authentication is not configured.", 500);
    }

    await dependencies.signOutToken(token);
    return c.json({ ok: true as const });
  });

  return routes;
}
