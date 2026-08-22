import { Hono } from "hono";

import type { MobileTodayResponse } from "@ega/contracts/mobile";
import {
  clearCompletedToday,
  getTodayPlan,
  planTaskForToday,
  removeTaskFromToday,
  toLocalIsoDate,
  updateTodayTaskStatus,
} from "@ega/application";
import { SupabaseTasksRepository, SupabaseTodayReadPort } from "@ega/data-access";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

export function createTodayRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const result = await getTodayPlan(
      actor,
      new SupabaseTodayReadPort(client),
      { date: c.req.query("date"), now: dependencies.now?.() },
    );
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);

    const payload = {
      ok: true as const,
      date: result.data.date,
      sections: result.data.sections,
      suggestions: result.data.suggestions,
      summary: result.data.summary,
      activeTimer: result.data.activeTimer,
    } satisfies MobileTodayResponse;
    return c.json(payload);
  });

  routes.post("/tasks/:id", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    const result = await planTaskForToday(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
      date: body.date ?? (dependencies.now ? toLocalIsoDate(dependencies.now()) : undefined),
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true, taskId: result.data.id });
  });

  routes.delete("/tasks/:id", async (c) => {
    const { actor, client } = c.var;
    const result = await removeTaskFromToday(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true, taskId: result.data.id });
  });

  routes.patch("/tasks/:id/status", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    const result = await updateTodayTaskStatus(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
      status: body.status,
      blockedReason: body.blockedReason,
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true, taskId: result.data.id, status: result.data.status });
  });

  routes.post("/clear-completed", async (c) => {
    const { actor, client } = c.var;
    const body = (await readJsonBody(c)) ?? {};
    const result = await clearCompletedToday(actor, new SupabaseTasksRepository(client), {
      date: body.date ?? (dependencies.now ? toLocalIsoDate(dependencies.now()) : new Date().toISOString().slice(0, 10)),
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true });
  });

  return routes;
}
