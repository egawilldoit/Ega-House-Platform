import { Hono } from "hono";

import {
  archiveGoal,
  createGoal,
  getGoalsReadModel,
  unarchiveGoal,
  updateGoalHealth,
  updateGoalNextStep,
  updateGoalStatus,
} from "@ega/application";
import type {
  CreateGoalResponse,
  GoalMutationResponse,
  GoalsReadModel,
} from "@ega/contracts/goals";
import { SupabaseGoalsRepository } from "@ega/data-access";
import { normalizeGoalViewFilter } from "@ega/domain";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

/**
 * Goals transport. Thin adapter only: every behavior lives in
 * `@ega/application` services/read models backed by the request-scoped
 * `@ega/data-access` repository. No business rule is duplicated here.
 */
export function createGoalsRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const view = normalizeGoalViewFilter(c.req.query("view"));

    const result = await getGoalsReadModel(
      actor,
      new SupabaseGoalsRepository(client),
      view,
    );

    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }

    return c.json(result.data satisfies GoalsReadModel);
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

    const result = await createGoal(
      actor,
      new SupabaseGoalsRepository(client),
      {
        title: body.title,
        projectId: body.projectId,
        description: body.description,
        nextStep: body.nextStep,
        health: body.health,
        status: body.status,
        slug: body.slug,
      },
    );

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    const response: CreateGoalResponse = { ok: true, values: result.values };
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

    const result = await updateGoalStatus(
      actor,
      new SupabaseGoalsRepository(client),
      {
        goalId: c.req.param("id"),
        status: body.status,
        now: dependencies.now?.(),
      },
    );

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    const response: GoalMutationResponse = { ok: true };
    return c.json(response);
  });

  routes.patch("/:id/health", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);

    if (!body) {
      return c.json(
        { error: { code: "VALIDATION", message: "Request body must be valid JSON." } },
        400,
      );
    }

    const result = await updateGoalHealth(
      actor,
      new SupabaseGoalsRepository(client),
      {
        goalId: c.req.param("id"),
        health: body.health,
        now: dependencies.now?.(),
      },
    );

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    const response: GoalMutationResponse = { ok: true };
    return c.json(response);
  });

  routes.patch("/:id/next-step", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);

    if (!body) {
      return c.json(
        { error: { code: "VALIDATION", message: "Request body must be valid JSON." } },
        400,
      );
    }

    const result = await updateGoalNextStep(
      actor,
      new SupabaseGoalsRepository(client),
      {
        goalId: c.req.param("id"),
        nextStep: body.nextStep,
        now: dependencies.now?.(),
      },
    );

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    const response: GoalMutationResponse = { ok: true };
    return c.json(response);
  });

  routes.post("/:id/archive", async (c) => {
    const { actor, client } = c.var;

    const result = await archiveGoal(
      actor,
      new SupabaseGoalsRepository(client),
      {
        goalId: c.req.param("id"),
        now: dependencies.now?.(),
      },
    );

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    const response: GoalMutationResponse = { ok: true };
    return c.json(response);
  });

  routes.post("/:id/unarchive", async (c) => {
    const { actor, client } = c.var;

    const result = await unarchiveGoal(
      actor,
      new SupabaseGoalsRepository(client),
      {
        goalId: c.req.param("id"),
        now: dependencies.now?.(),
      },
    );

    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }

    const response: GoalMutationResponse = { ok: true };
    return c.json(response);
  });

  return routes;
}
