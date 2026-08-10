import { Hono } from "hono";

import {
  archiveTask,
  cancelTaskReminder,
  createTask,
  createTaskReminder,
  getTaskReadModel,
  getTasksReadModel,
  unarchiveTask,
  updateTask,
  type TaskQuery,
} from "@ega/application";
import { SupabaseTasksRepository } from "@ega/data-access";
import { isTaskStatus } from "@ega/domain";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

function queryFromRequest(query: (name: string) => string | undefined): TaskQuery {
  const statusCandidate = query("status");
  const limitCandidate = Number(query("limit"));

  return {
    status: statusCandidate && isTaskStatus(statusCandidate) ? statusCandidate : null,
    projectId: query("projectId")?.trim() || null,
    goalId: query("goalId")?.trim() || null,
    plannedForDate: query("plannedForDate")?.trim() || null,
    includeArchived: query("includeArchived") === "true",
    limit: Number.isFinite(limitCandidate) && limitCandidate > 0 ? Math.floor(limitCandidate) : null,
  };
}

export function createTasksRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const result = await getTasksReadModel(
      actor,
      new SupabaseTasksRepository(client),
      queryFromRequest((name) => c.req.query(name)),
    );

    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }

    return c.json(result.data);
  });

  routes.get("/:id", async (c) => {
    const { actor, client } = c.var;
    const result = await getTaskReadModel(
      actor,
      new SupabaseTasksRepository(client),
      c.req.param("id"),
    );

    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }
    if (!result.data) {
      return c.json({ error: { code: "NOT_FOUND", message: "Task not found." } }, 404);
    }

    return c.json(result.data);
  });

  routes.post("/", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json(
        { error: { code: "VALIDATION", message: "Request body must be valid JSON." } },
        400,
      );
    }

    const result = await createTask(actor, new SupabaseTasksRepository(client), {
      title: body.title,
      projectId: body.projectId,
      goalId: body.goalId,
      description: body.description,
      blockedReason: body.blockedReason,
      status: body.status,
      priority: body.priority,
      dueDate: body.dueDate,
      estimateMinutes: body.estimateMinutes,
    });

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    return c.json({ ok: true, task: result.data }, 201);
  });

  routes.patch("/:id", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json(
        { error: { code: "VALIDATION", message: "Request body must be valid JSON." } },
        400,
      );
    }

    const result = await updateTask(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
      title: body.title,
      description: body.description,
      blockedReason: body.blockedReason,
      status: body.status,
      priority: body.priority,
      dueDate: body.dueDate,
      estimateMinutes: body.estimateMinutes,
      projectId: body.projectId,
      goalId: body.goalId,
    });

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    return c.json({ ok: true, task: result.data });
  });

  routes.post("/:id/archive", async (c) => {
    const { actor, client } = c.var;
    const result = await archiveTask(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
      now: dependencies.now?.(),
    });

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }
    return c.json({ ok: true, task: result.data });
  });

  routes.post("/:id/unarchive", async (c) => {
    const { actor, client } = c.var;
    const result = await unarchiveTask(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
    });

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }
    return c.json({ ok: true, task: result.data });
  });

  routes.post("/:id/reminders", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json(
        { error: { code: "VALIDATION", message: "Request body must be valid JSON." } },
        400,
      );
    }

    const result = await createTaskReminder(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
      remindAt: body.remindAt,
      now: dependencies.now?.(),
    });

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }
    return c.json({ ok: true, task: result.data }, 201);
  });

  routes.patch("/:id/reminders/:reminderId", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body || body.status !== "cancelled") {
      return c.json(
        { error: { code: "VALIDATION", message: "Reminder status must be cancelled." } },
        400,
      );
    }

    const result = await cancelTaskReminder(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
      reminderId: c.req.param("reminderId"),
    });

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }
    return c.json({ ok: true, task: result.data });
  });

  return routes;
}
