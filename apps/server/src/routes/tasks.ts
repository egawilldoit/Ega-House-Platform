import { Hono } from "hono";

import {
  archiveTask,
  cancelTaskReminder,
  clearTaskRecurrence,
  createTask,
  createTaskReminder,
  getTasksReadModel,
  parseMobileTaskListQuery,
  pinTask,
  resolveTimeContext,
  setTaskRecurrence,
  toMobileTaskListItem,
  unarchiveTask,
  unpinTask,
  updateTask,
  getTaskReadModel,
} from "@ega/application";
import type { MobileTaskListResponse } from "@ega/contracts/mobile";
import { SupabaseTasksRepository, SupabaseTimeContextRepository } from "@ega/data-access";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

/**
 * Composes the effective due date for recurrence anchor fallback.
 *
 * The final fallback is the owner's EGA local date (from Time Context), never
 * the UTC date, so recurrence anchors agree with the owner's calendar day.
 */
function recurrenceFallbackAnchor(
  bodyDueDate: unknown,
  effectiveDueDate: string | null | undefined,
  localDate: string | null,
) {
  const candidate = String(bodyDueDate ?? "").trim();
  if (candidate) return candidate;
  if (effectiveDueDate) return effectiveDueDate;
  if (localDate) return localDate;
  return null;
}

export function createTasksRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const parsed = parseMobileTaskListQuery((name) => c.req.query(name));
    if (!parsed.ok) {
      return c.json({ error: { code: "VALIDATION", message: parsed.message } }, 400);
    }

    const now = dependencies.now?.() ?? new Date();
    const timeContextResult = await resolveTimeContext(
      actor,
      new SupabaseTimeContextRepository(client as never),
      { now },
    );
    if (!timeContextResult.ok) {
      return c.json({ error: { code: "INTERNAL", message: timeContextResult.errorMessage } }, 500);
    }

    const result = await getTasksReadModel(
      actor,
      new SupabaseTasksRepository(client),
      parsed.data,
      { now, localDate: timeContextResult.data.localDate },
    );
    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }
    return c.json(result.data satisfies MobileTaskListResponse);
  });

  routes.get("/:id", async (c) => {
    const { actor, client } = c.var;
    const result = await getTaskReadModel(actor, new SupabaseTasksRepository(client), c.req.param("id"));
    if (!result.ok) return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    if (!result.data) return c.json({ error: { code: "NOT_FOUND", message: "Task not found." } }, 404);
    return c.json({ ok: true as const, task: result.data });
  });

  routes.post("/", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);

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
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);

    // Recurrence rides along in one create call when requested; the created
    // task's due date anchors the schedule when no explicit anchor is given.
    if (body.recurrenceRule !== undefined && body.recurrenceRule !== null) {
      const now = dependencies.now?.() ?? new Date();
      const timeContext = await resolveTimeContext(
        actor,
        new SupabaseTimeContextRepository(client as never),
        { now },
      );
      const localDate = timeContext.ok ? timeContext.data.localDate : null;
      const accountTimezone = timeContext.ok ? timeContext.data.timezone : null;
      const recurrenceResult = await setTaskRecurrence(actor, new SupabaseTasksRepository(client), {
        taskId: result.data.id,
        recurrenceRule: body.recurrenceRule,
        recurrenceAnchorDate: body.recurrenceAnchorDate,
        recurrenceTimezone: body.recurrenceTimezone,
        defaultTimezone: accountTimezone,
        fallbackAnchorDate: recurrenceFallbackAnchor(body.dueDate, undefined, localDate),
      });
      if (!recurrenceResult.ok) {
        return c.json({ error: { code: "VALIDATION", message: recurrenceResult.errorMessage } }, 400);
      }
      return c.json({ ok: true as const, task: toMobileTaskListItem(recurrenceResult.data) }, { status: 201 });
    }

    return c.json({ ok: true as const, task: toMobileTaskListItem(result.data) }, { status: 201 });
  });

  routes.patch("/:id", async (c) => {
    const { actor, client } = c.var;
    const taskId = c.req.param("id");
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);

    const result = await updateTask(actor, new SupabaseTasksRepository(client), {
      taskId,
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
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);

    // Recurrence changes ride along in the same PATCH: a rule updates or
    // creates the schedule, an explicit null clears it.
    if (body.recurrenceRule !== undefined) {
      const now = dependencies.now?.() ?? new Date();
      const timeContext = await resolveTimeContext(
        actor,
        new SupabaseTimeContextRepository(client as never),
        { now },
      );
      const localDate = timeContext.ok ? timeContext.data.localDate : null;
      const accountTimezone = timeContext.ok ? timeContext.data.timezone : null;
      const recurrenceResult =
        body.recurrenceRule === null
          ? await clearTaskRecurrence(actor, new SupabaseTasksRepository(client), { taskId })
          : await setTaskRecurrence(actor, new SupabaseTasksRepository(client), {
              taskId,
              recurrenceRule: body.recurrenceRule,
              recurrenceAnchorDate: body.recurrenceAnchorDate,
              recurrenceTimezone: body.recurrenceTimezone,
              defaultTimezone: accountTimezone,
              fallbackAnchorDate: recurrenceFallbackAnchor(
                body.dueDate,
                result.data.dueDate,
                localDate,
              ),
            });
      if (!recurrenceResult.ok) {
        return c.json({ error: { code: "VALIDATION", message: recurrenceResult.errorMessage } }, 400);
      }
      return c.json({ ok: true as const, task: toMobileTaskListItem(recurrenceResult.data) });
    }

    return c.json({ ok: true as const, task: toMobileTaskListItem(result.data) });
  });

  routes.post("/:id/archive", async (c) => {
    const { actor, client } = c.var;
    const result = await archiveTask(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
      now: dependencies.now?.(),
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true as const, task: toMobileTaskListItem(result.data) });
  });

  routes.post("/:id/unarchive", async (c) => {
    const { actor, client } = c.var;
    const result = await unarchiveTask(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true as const, task: toMobileTaskListItem(result.data) });
  });

  routes.post("/:id/pin", async (c) => {
    const { actor, client } = c.var;
    const result = await pinTask(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
    });
    if (!result.ok) {
      const notFound = result.errorMessage.includes("unavailable");
      return c.json(
        { error: { code: notFound ? "NOT_FOUND" : "VALIDATION", message: result.errorMessage } },
        notFound ? 404 : 400,
      );
    }
    return c.json(result.data);
  });

  routes.post("/:id/unpin", async (c) => {
    const { actor, client } = c.var;
    const result = await unpinTask(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
    });
    if (!result.ok) {
      const notFound = result.errorMessage.includes("unavailable");
      return c.json(
        { error: { code: notFound ? "NOT_FOUND" : "VALIDATION", message: result.errorMessage } },
        notFound ? 404 : 400,
      );
    }
    return c.json(result.data);
  });

  routes.post("/:id/reminders", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    const result = await createTaskReminder(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
      remindAt: body.remindAt,
      deliveryMode: body.deliveryMode,
      now: dependencies.now?.(),
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true as const, task: toMobileTaskListItem(result.data) }, { status: 201 });
  });

  routes.patch("/:id/reminders/:reminderId", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body || body.status !== "cancelled") {
      return c.json({ error: { code: "VALIDATION", message: "Reminder status must be cancelled." } }, 400);
    }
    const result = await cancelTaskReminder(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
      reminderId: c.req.param("reminderId"),
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true as const, task: toMobileTaskListItem(result.data) });
  });

  routes.put("/:id/recurrence", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    const now = dependencies.now?.() ?? new Date();
    const timeContext = await resolveTimeContext(
      actor,
      new SupabaseTimeContextRepository(client as never),
      { now },
    );
    const localDate = timeContext.ok ? timeContext.data.localDate : null;
    const accountTimezone = timeContext.ok ? timeContext.data.timezone : null;
    const result = await setTaskRecurrence(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
      recurrenceRule: body.recurrenceRule,
      recurrenceAnchorDate: body.recurrenceAnchorDate,
      recurrenceTimezone: body.recurrenceTimezone,
      defaultTimezone: accountTimezone,
      fallbackAnchorDate:
        String(body.fallbackAnchorDate ?? "").trim() ||
        localDate ||
        (now as Date).toISOString().slice(0, 10),
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true as const, task: toMobileTaskListItem(result.data) });
  });

  routes.delete("/:id/recurrence", async (c) => {
    const { actor, client } = c.var;
    const result = await clearTaskRecurrence(actor, new SupabaseTasksRepository(client), {
      taskId: c.req.param("id"),
    });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true as const, task: toMobileTaskListItem(result.data) });
  });

  return routes;
}
