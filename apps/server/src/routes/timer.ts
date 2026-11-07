import { Hono } from "hono";

import {
  getTimerWorkspace,
  startTaskSession,
  stopTaskSession,
  TIMER_ALREADY_RUNNING_MESSAGE,
  TIMER_NO_OPEN_SESSION_MATCH_MESSAGE,
  TIMER_SESSION_ID_REQUIRED_MESSAGE,
  TIMER_SESSION_NO_LONGER_RUNNING_MESSAGE,
} from "@ega/application";
import {
  SupabaseTimeContextRepository,
  SupabaseTimerSessionRepository,
} from "@ega/data-access";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

// Mirrors the MCP stop-timer schema (`z.string().uuid()`), so a malformed id is
// rejected at the transport boundary instead of reaching PostgREST and being
// reported as a dependency failure.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIMER_SESSION_ID_INVALID_MESSAGE = "Invalid timer session id.";

export function createTimerRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/workspace", async (c) => {
    const { actor, client } = c.var;
    const timezone = c.req.query("timezone") ?? c.req.query("tz") ?? null;
    const result = await getTimerWorkspace(
      actor,
      new SupabaseTimerSessionRepository(client),
      new SupabaseTimeContextRepository(client as never),
      { now: dependencies.now?.(), timezone: timezone ?? undefined },
    );
    if (!result.ok) return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    return c.json(result.data);
  });

  routes.post("/start", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);

    const result = await startTaskSession(
      actor,
      new SupabaseTimerSessionRepository(client),
      { taskId: body.taskId },
      { now: dependencies.now?.() },
    );
    if (!result.ok) {
      // A lost unique-index race is a state conflict, not malformed input.
      const conflict = result.errorMessage === TIMER_ALREADY_RUNNING_MESSAGE;
      return c.json(
        { error: { code: conflict ? "CONFLICT" : "VALIDATION", message: result.errorMessage } },
        conflict ? 409 : 400,
      );
    }
    return c.json({ ok: true, activeSession: result.data }, 201);
  });

  routes.post("/stop", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    if (!body || !sessionId) {
      return c.json(
        { error: { code: "VALIDATION", message: TIMER_SESSION_ID_REQUIRED_MESSAGE } },
        400,
      );
    }
    if (!UUID_PATTERN.test(sessionId)) {
      return c.json(
        { error: { code: "VALIDATION", message: TIMER_SESSION_ID_INVALID_MESSAGE } },
        400,
      );
    }

    const result = await stopTaskSession(
      actor,
      new SupabaseTimerSessionRepository(client),
      { sessionId },
      { now: dependencies.now?.() },
    );
    if (!result.ok) {
      // An id that is not an open session for this owner is not-found, and a
      // fenced finalize that leaves the same session open is a state conflict,
      // mirroring the MCP timer mapping.
      if (result.errorMessage === TIMER_NO_OPEN_SESSION_MATCH_MESSAGE) {
        return c.json(
          { error: { code: "NOT_FOUND", message: result.errorMessage } },
          404,
        );
      }
      if (result.errorMessage === TIMER_SESSION_NO_LONGER_RUNNING_MESSAGE) {
        return c.json(
          { error: { code: "CONFLICT", message: result.errorMessage } },
          409,
        );
      }
      return c.json(
        { error: { code: "VALIDATION", message: result.errorMessage } },
        400,
      );
    }
    return c.json({
      ok: true,
      sessionId: result.data.sessionId,
      taskId: result.data.taskId,
      outcome: result.data.status,
    });
  });

  return routes;
}
