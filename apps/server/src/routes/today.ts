import { Hono } from "hono";

import {
  clearCompletedToday,
  getTodayReadModel,
  planTaskForToday,
  removeTaskFromToday,
  updateTodayTaskStatus,
} from "@ega/application";
import { SupabaseTasksRepository } from "@ega/data-access";

import type { ServerVariables } from "../app";
import { readJsonBody } from "../app";

export function createTodayRoutes(): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const result = await getTodayReadModel(actor, new SupabaseTasksRepository(client), c.req.query("date"));
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json(result.data);
  });

  routes.post("/tasks/:id", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    const result = await planTaskForToday(actor, new SupabaseTasksRepository(client), { taskId: c.req.param("id"), date: body.date });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true, task: result.data });
  });

  routes.delete("/tasks/:id", async (c) => {
    const { actor, client } = c.var;
    const result = await removeTaskFromToday(actor, new SupabaseTasksRepository(client), { taskId: c.req.param("id") });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true, task: result.data });
  });

  routes.patch("/tasks/:id/status", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    const result = await updateTodayTaskStatus(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"), status: body.status, blockedReason: body.blockedReason,
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true, task: result.data });
  });

  routes.post("/clear-completed", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    const result = await clearCompletedToday(actor, new SupabaseTasksRepository(client), { date: body.date });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true, clearedCount: result.data.clearedCount });
  });

  return routes;
}
