import { Hono } from "hono";

import {
  archiveProject,
  createProject,
  deleteArchivedProject,
  getProjectIdentityReadModel,
  getProjectPurgePreview,
  getProjectsReadModel,
  purgeArchivedProject,
  unarchiveProject,
  updateProjectStatus,
} from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";
import { normalizeProjectViewFilter } from "@ega/domain";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

/**
 * Projects transport. Thin adapter only: every behavior lives in
 * `@ega/application` services/read models backed by the request-scoped
 * `@ega/data-access` repository. No business rule is duplicated here.
 */
export function createProjectsRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const view = normalizeProjectViewFilter(c.req.query("view"));

    const result = await getProjectsReadModel(
      actor,
      new SupabaseProjectsRepository(client),
      view,
    );

    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }

    return c.json(result.data);
  });

  routes.get("/:slug", async (c) => {
    const { actor, client } = c.var;

    const result = await getProjectIdentityReadModel(
      actor,
      new SupabaseProjectsRepository(client),
      c.req.param("slug"),
    );

    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }

    if (!result.data) {
      return c.json({ error: { code: "NOT_FOUND", message: "Project not found." } }, 404);
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

    const result = await createProject(
      actor,
      new SupabaseProjectsRepository(client),
      {
        name: body.name,
        slug: body.slug,
        description: body.description,
      },
    );

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    return c.json({ ok: true, values: result.values }, 201);
  });

  routes.patch("/:id/status", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);

    if (!body) {
      return c.json(
        { error: { code: "VALIDATION", message: "Request body must be valid JSON." } },
        400,
      );
    }

    const result = await updateProjectStatus(
      actor,
      new SupabaseProjectsRepository(client),
      {
        projectId: c.req.param("id"),
        status: body.status,
        now: dependencies.now?.(),
      },
    );

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    return c.json({ ok: true });
  });

  routes.post("/:id/archive", async (c) => {
    const { actor, client } = c.var;

    const result = await archiveProject(
      actor,
      new SupabaseProjectsRepository(client),
      {
        projectId: c.req.param("id"),
        now: dependencies.now?.(),
      },
    );

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    return c.json({ ok: true });
  });

  routes.post("/:id/unarchive", async (c) => {
    const { actor, client } = c.var;

    const result = await unarchiveProject(
      actor,
      new SupabaseProjectsRepository(client),
      {
        projectId: c.req.param("id"),
        now: dependencies.now?.(),
      },
    );

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    return c.json({ ok: true });
  });

  routes.delete("/:id", async (c) => {
    const { actor, client } = c.var;

    const result = await deleteArchivedProject(
      actor,
      new SupabaseProjectsRepository(client),
      { projectId: c.req.param("id") },
    );

    if (result.ok) {
      return c.json({ ok: true });
    }

    // Dependency conflicts keep the established VALIDATION envelope code and
    // signal through HTTP 409; the typed client preserves both status and code.
    if (result.code === "conflict") {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 409);
    }

    if (result.code === "notFound") {
      return c.json({ error: { code: "NOT_FOUND", message: result.errorMessage } }, 404);
    }

    if (result.code === "validation") {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
  });

  routes.get("/:id/purge-preview", async (c) => {
    const { actor, client } = c.var;

    const result = await getProjectPurgePreview(
      actor,
      new SupabaseProjectsRepository(client),
      { projectId: c.req.param("id") },
    );

    if (result.ok) {
      const preview = result.data;
      return c.json({
        projectId: preview.projectId,
        projectName: preview.projectName,
        impact: {
          taskCount: preview.taskCount,
          goalCount: preview.goalCount,
          sessionCount: preview.sessionCount,
          activeSessionCount: preview.activeSessionCount,
          reminderCount: preview.reminderCount,
          recurrenceCount: preview.recurrenceCount,
          externalRefCount: preview.externalRefCount,
          taskNotificationCount: preview.taskNotificationCount,
          calendarEventCount: preview.calendarEventCount,
        },
      });
    }

    if (result.code === "notFound") {
      return c.json({ error: { code: "NOT_FOUND", message: result.errorMessage } }, 404);
    }

    if (result.code === "validation") {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
  });

  routes.post("/:id/purge", async (c) => {
    const { actor, client } = c.var;

    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    }

    const result = await purgeArchivedProject(
      actor,
      new SupabaseProjectsRepository(client),
      {
        projectId: c.req.param("id"),
        confirmationName: body.confirmationName,
        expectedTaskCount: body.expectedTaskCount,
        expectedGoalCount: body.expectedGoalCount,
      },
    );

    if (result.ok) {
      return c.json({ ok: true, deleted: result.data });
    }

    // Contents-changed conflicts keep the established VALIDATION envelope
    // code and signal through HTTP 409; the typed client preserves both.
    if (result.code === "conflict") {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 409);
    }

    if (result.code === "notFound") {
      return c.json({ error: { code: "NOT_FOUND", message: result.errorMessage } }, 404);
    }

    if (result.code === "validation") {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
  });

  return routes;
}
