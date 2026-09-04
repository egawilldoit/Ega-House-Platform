import { Hono } from "hono";

import {
  archiveInboxItem,
  convertInboxItemToTask,
  createInboxItem,
  getInboxItem,
  listInboxItems,
  parseInboxListQuery,
  restoreInboxItem,
  updateInboxItem,
} from "@ega/application";
import { convertInboxInputSchema } from "@ega/contracts/inbox";
import { SupabaseInboxRepository, SupabaseTasksRepository } from "@ega/data-access";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

function getIdempotencyKey(c: { req: { header: (name: string) => string | undefined } }): string | null {
  // Accept both header spellings; Hono header lookup is case-insensitive but we try variants.
  const key =
    c.req.header("x-idempotency-key") ??
    c.req.header("X-Idempotency-Key") ??
    c.req.header("idempotency-key") ??
    null;
  return key ? String(key).trim() || null : null;
}

export function createInboxRoutes(
  _dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  void _dependencies;
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const parsed = parseInboxListQuery((name) => c.req.query(name));
    if (!parsed.ok) {
      return c.json({ error: { code: "VALIDATION", message: parsed.message } }, 400);
    }

    const repo = new SupabaseInboxRepository(client as unknown as SupabaseClient);
    const result = await listInboxItems(actor, repo, parsed.data);
    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }

    // Also fetch projects for form options, mirroring web's project options.
    const projectsResult = await repo.listProjectOptions(actor);
    if (!projectsResult.ok) {
      return c.json({ error: { code: "INTERNAL", message: "Unable to load projects right now." } }, 500);
    }

    return c.json({
      ok: true as const,
      items: result.data,
      projects: projectsResult.value,
      filters: {
        view: parsed.data.view,
        search: parsed.data.search ?? "",
        type: parsed.data.type ?? "all",
        status: parsed.data.status ?? "all",
        projectId:
          parsed.data.projectFilter === "none"
            ? "none"
            : parsed.data.projectFilter === "all"
              ? "all"
              : parsed.data.projectId ?? "all",
        priority:
          parsed.data.priorityFilter === "none"
            ? "none"
            : parsed.data.priorityFilter === "all"
              ? "all"
              : parsed.data.priority ?? "all",
        tag: parsed.data.tag ?? "",
      },
      total: result.data.length,
    });
  });

  routes.get("/:id", async (c) => {
    const { actor, client } = c.var;
    const repo = new SupabaseInboxRepository(client as unknown as SupabaseClient);
    const result = await getInboxItem(actor, repo, c.req.param("id"));
    if (!result.ok) return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    if (!result.data) return c.json({ error: { code: "NOT_FOUND", message: "Idea not found." } }, 404);
    return c.json({ ok: true as const, item: result.data });
  });

  routes.post("/", async (c) => {
    const { actor, client } = c.var;
    const idempotencyKey = getIdempotencyKey(c);
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);

    const repo = new SupabaseInboxRepository(client as unknown as SupabaseClient);
    // Idempotency: check pre-existing mapping to decide 200 vs 201 per HTTP semantics.
    // If server can distinguish replay (existing key) from fresh create, return 200 for
    // replay, 201 for new. This uses repository lookup before application call; the
    // application layer also handles race idempotency, so 201->200 distinction is best-effort
    // and clients accept both.
    let isReplay = false;
    if (idempotencyKey) {
      const pre = await repo.getInboxItemByIdempotencyKey(actor, idempotencyKey);
      if (pre.ok && pre.value) isReplay = true;
    }
    const result = await createInboxItem(actor, repo, {
      title: body.title,
      body: body.body,
      type: body.type,
      projectId: body.projectId ?? body.project_id,
      priority: body.priority,
      tags: body.tags,
      tagsInput: body.tagsInput ?? body.tags_input,
      idempotencyKey: idempotencyKey ?? undefined,
    });

    if (!result.ok) {
      const code = (result as unknown as { code?: string }).code;
      if (code === "conflict") return c.json({ error: { code: "CONFLICT", message: result.errorMessage } }, 409);
      if (code === "validation") return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
      if (code === "notFound") return c.json({ error: { code: "NOT_FOUND", message: result.errorMessage } }, 404);
      // Fallback to validation for backward compat when code missing
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    // Echo idempotency key if provided (helps clients correlate retries).
    if (idempotencyKey) c.header("X-Idempotency-Key", idempotencyKey);

    // Conventional HTTP: 201 for newly created, 200 for idempotent replay.
    return c.json({ ok: true as const, item: result.data }, isReplay ? 200 : 201);
  });

  routes.patch("/:id", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);

    const repo = new SupabaseInboxRepository(client as unknown as SupabaseClient);
    const result = await updateInboxItem(actor, repo, {
      id: c.req.param("id"),
      title: body.title,
      body: body.body,
      type: body.type,
      projectId: body.projectId ?? body.project_id,
      priority: body.priority,
      tags: body.tags,
      tagsInput: body.tagsInput ?? body.tags_input,
      status: body.status,
    });

    if (!result.ok) {
      const code = (result as unknown as { code?: string }).code;
      if (code === "conflict") return c.json({ error: { code: "CONFLICT", message: result.errorMessage } }, 409);
      if (code === "notFound") return c.json({ error: { code: "NOT_FOUND", message: result.errorMessage } }, 404);
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }
    return c.json({ ok: true as const, item: result.data });
  });

  routes.post("/:id/archive", async (c) => {
    const { actor, client } = c.var;
    const repo = new SupabaseInboxRepository(client as unknown as SupabaseClient);
    const result = await archiveInboxItem(actor, repo, { id: c.req.param("id") });
    if (!result.ok) {
      const code = (result as unknown as { code?: string }).code;
      if (code === "conflict") return c.json({ error: { code: "CONFLICT", message: result.errorMessage } }, 409);
      if (code === "notFound") return c.json({ error: { code: "NOT_FOUND", message: result.errorMessage } }, 404);
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }
    return c.json({ ok: true as const, item: result.data });
  });

  routes.post("/:id/restore", async (c) => {
    const { actor, client } = c.var;
    const repo = new SupabaseInboxRepository(client as unknown as SupabaseClient);
    const result = await restoreInboxItem(actor, repo, { id: c.req.param("id") });
    if (!result.ok) {
      const code = (result as unknown as { code?: string }).code;
      if (code === "conflict") return c.json({ error: { code: "CONFLICT", message: result.errorMessage } }, 409);
      if (code === "notFound") return c.json({ error: { code: "NOT_FOUND", message: result.errorMessage } }, 404);
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }
    return c.json({ ok: true as const, item: result.data });
  });

  routes.post("/:id/convert", async (c) => {
    const { actor, client } = c.var;
    const inboxId = c.req.param("id");
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);

    const parsed = convertInboxInputSchema.safeParse(body ?? {});
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid conversion input.";
      return c.json({ error: { code: "VALIDATION", message } }, 400);
    }

    const inboxRepo = new SupabaseInboxRepository(client as unknown as SupabaseClient);
    const tasksRepo = new SupabaseTasksRepository(client as unknown as SupabaseClient);
    const result = await convertInboxItemToTask(actor, inboxRepo, tasksRepo, {
      inboxItemId: inboxId,
      projectId: parsed.data.projectId,
      goalId: parsed.data.goalId,
      priority: parsed.data.priority,
      dueDate: parsed.data.dueDate,
      title: parsed.data.title,
      description: parsed.data.description,
      remindAt: parsed.data.remindAt,
    });

    if (!result.ok) {
      const code = (result as unknown as { code?: string }).code;
      if (code === "conflict") return c.json({ error: { code: "CONFLICT", message: result.errorMessage } }, 409);
      if (code === "notFound") return c.json({ error: { code: "NOT_FOUND", message: result.errorMessage } }, 404);
      // Fallback: map known messages when code missing for backward compat
      if (code === "validation") return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
      const msg = result.errorMessage;
      if (msg.includes("unavailable") || msg.includes("not found")) {
        return c.json({ error: { code: "NOT_FOUND", message: msg } }, 404);
      }
      if (msg.includes("already converted") || msg.includes("conflict")) {
        return c.json({ error: { code: "CONFLICT", message: msg } }, 409);
      }
      return c.json({ error: { code: "VALIDATION", message: msg } }, 400);
    }

    return c.json({ ok: true as const, item: result.data.inboxItem, task: result.data.task }, 201);
  });

  return routes;
}
