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
import type {
  CreateProjectResponse,
  ProjectIdentityReadModel,
  ProjectMutationResponse,
  ProjectPurgePreviewResponse,
  ProjectPurgeResponse,
  ProjectsReadModel,
  PurgeProjectInput,
} from "@ega/contracts/projects";
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

    return c.json(result.data satisfies ProjectsReadModel);
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

    return c.json(result.data satisfies ProjectIdentityReadModel);
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

    const response: CreateProjectResponse = { ok: true, values: result.values };
    return c.json(response, 201);
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

    const response: ProjectMutationResponse = { ok: true };
    return c.json(response);
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

    const response: ProjectMutationResponse = { ok: true };
    return c.json(response);
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

    const response: ProjectMutationResponse = { ok: true };
    return c.json(response);
  });

  routes.delete("/:id", async (c) => {
    const { actor, client } = c.var;

    const result = await deleteArchivedProject(
      actor,
      new SupabaseProjectsRepository(client),
      { projectId: c.req.param("id") },
    );

    if (result.ok) {
      const response: ProjectMutationResponse = { ok: true };
      return c.json(response);
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
      const response: ProjectPurgePreviewResponse = {
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
      };
      return c.json(response);
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

    // `readJsonBody` remains intentionally untrusted; the application validates
    // these values. This assertion names the shared wire contract without
    // changing the existing invalid-input behavior.
    const purgeInput = body as unknown as PurgeProjectInput;

    const result = await purgeArchivedProject(
      actor,
      new SupabaseProjectsRepository(client),
      {
        projectId: c.req.param("id"),
        ...purgeInput,
      },
    );

    if (result.ok) {
      const response: ProjectPurgeResponse = { ok: true, deleted: result.data };
      return c.json(response);
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
