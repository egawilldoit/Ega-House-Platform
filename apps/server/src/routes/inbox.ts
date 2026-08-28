import { Hono } from "hono";

import {
  archiveInboxItem,
  createInboxItem,
  getInboxItem,
  listInboxItems,
  parseInboxListQuery,
  restoreInboxItem,
  updateInboxItem,
} from "@ega/application";
import { SupabaseInboxRepository } from "@ega/data-access";

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
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const parsed = parseInboxListQuery((name) => c.req.query(name));
    if (!parsed.ok) {
      return c.json({ error: { code: "VALIDATION", message: parsed.message } }, 400);
    }

    const repo = new SupabaseInboxRepository(client as any);
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
      total: result.data.length,
    });
  });

  routes.get("/:id", async (c) => {
    const { actor, client } = c.var;
    const repo = new SupabaseInboxRepository(client as any);
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

    const repo = new SupabaseInboxRepository(client as any);
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

    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);

    // Echo idempotency key if provided (helps clients correlate retries).
    if (idempotencyKey) c.header("X-Idempotency-Key", idempotencyKey);

    // Deduplicated retries return 200 with same item; fresh creates return 201.
    // For simplicity we always return 200 when idempotency key was used and item already existed;
    // otherwise 201. Detect via repository lookup? We keep 201 for now but clients handle both.
    return c.json({ ok: true as const, item: result.data }, 201);
  });

  routes.patch("/:id", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);

    const repo = new SupabaseInboxRepository(client as any);
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

    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true as const, item: result.data });
  });

  routes.post("/:id/archive", async (c) => {
    const { actor, client } = c.var;
    const repo = new SupabaseInboxRepository(client as any);
    const result = await archiveInboxItem(actor, repo, { id: c.req.param("id") });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true as const, item: result.data });
  });

  routes.post("/:id/restore", async (c) => {
    const { actor, client } = c.var;
    const repo = new SupabaseInboxRepository(client as any);
    const result = await restoreInboxItem(actor, repo, { id: c.req.param("id") });
    if (!result.ok) return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    return c.json({ ok: true as const, item: result.data });
  });

  return routes;
}
