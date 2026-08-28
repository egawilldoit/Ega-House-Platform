import { Hono, type Context } from "hono";

import type { MobileTodayResponse } from "@ega/contracts/mobile";
import {
  clearCompletedToday,
  getTaskReadModel,
  getTodayPlan,
  planTaskForToday,
  removeTaskFromToday,
  updateTodayTaskStatus,
} from "@ega/application";
import { SupabaseTasksRepository, SupabaseTodayReadPort } from "@ega/data-access";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

/**
 * Legacy mobile transports mapped "task is unavailable" failures to 404 and
 * infrastructure failures to 500. The canonical application layer reports
 * both as plain validation-style failures, so mutations probe ownership
 * first: a missing task answers 404 NOT_FOUND before any write is attempted.
 * Returns the early error Response, or null when the task is owned.
 */
async function resolveOwnedTaskOr404(
  c: Context<{ Variables: ServerVariables }>,
  actor: Parameters<typeof getTaskReadModel>[0],
  repository: SupabaseTasksRepository,
  taskId: string,
): Promise<Response | null> {
  const probe = await getTaskReadModel(actor, repository, taskId);
  if (!probe.ok) {
    return c.json({ error: { code: "INTERNAL", message: probe.errorMessage } }, 500);
  }
  if (!probe.data) {
    return c.json({ error: { code: "NOT_FOUND", message: "Task is unavailable." } }, 404);
  }
  return null;
}

export function createTodayRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const timezone = c.req.query("timezone") ?? c.req.query("tz") ?? null;
    const result = await getTodayPlan(
      actor,
      new SupabaseTodayReadPort(client),
      { date: c.req.query("date"), timezone, now: dependencies.now?.() },
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
    const repository = new SupabaseTasksRepository(client);
    const body = await readJsonBody(c);
    const earlyResponse = await resolveOwnedTaskOr404(c, actor, repository, c.req.param("id"));
    if (earlyResponse) return earlyResponse;

    const fallbackDate = body?.date
      ? String(body.date)
      : body?.timezone
        ? null
        : dependencies.now
          ? dependencies.now().toISOString().slice(0, 10)
          : undefined;
    const result = await planTaskForToday(actor, repository, {
      taskId: c.req.param("id"),
      date: fallbackDate ?? body?.date,
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true, taskId: result.data.id });
  });

  routes.delete("/tasks/:id", async (c) => {
    const { actor, client } = c.var;
    const repository = new SupabaseTasksRepository(client);
    const earlyResponse = await resolveOwnedTaskOr404(c, actor, repository, c.req.param("id"));
    if (earlyResponse) return earlyResponse;

    const result = await removeTaskFromToday(actor, repository, {
      taskId: c.req.param("id"),
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true, taskId: result.data.id });
  });

  routes.patch("/tasks/:id/status", async (c) => {
    const { actor, client } = c.var;
    const repository = new SupabaseTasksRepository(client);
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    if (typeof body.status !== "string") {
      return c.json({ error: { code: "VALIDATION", message: "Task status is invalid." } }, 400);
    }
    const earlyResponse = await resolveOwnedTaskOr404(c, actor, repository, c.req.param("id"));
    if (earlyResponse) return earlyResponse;

    const result = await updateTodayTaskStatus(actor, repository, {
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
    const fallbackClearDate = body.date
      ? String(body.date)
      : dependencies.now
        ? dependencies.now().toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    const result = await clearCompletedToday(actor, new SupabaseTasksRepository(client), {
      date: fallbackClearDate,
    });
    if (!result.ok) return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    return c.json({ ok: true });
  });

  return routes;
}
