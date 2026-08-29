import { Hono } from "hono";

import {
  getTimerWorkspace,
  startTaskSession,
  stopTaskSession,
} from "@ega/application";
import {
  SupabaseTimeContextRepository,
  SupabaseTimerSessionRepository,
} from "@ega/data-access";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

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
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true, activeSession: result.data }, 201);
  });

  routes.post("/stop", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);

    const result = await stopTaskSession(
      actor,
      new SupabaseTimerSessionRepository(client),
      { sessionId: body?.sessionId },
      { now: dependencies.now?.() },
    );
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true, sessionId: result.data.sessionId, taskId: result.data.taskId });
  });

  return routes;
}
