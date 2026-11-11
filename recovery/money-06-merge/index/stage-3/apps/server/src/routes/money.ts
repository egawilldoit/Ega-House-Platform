import { Hono } from "hono";
import type { Context } from "hono";

import {
  createObligation,
  createObligationTemplate,
  generateObligations,
  getObligation,
  getObligationSummary,
  getObligationTemplate,
  listObligations,
  listObligationTemplates,
  transitionObligation,
  updateObligation,
  updateObligationTemplate,
  type ApplicationErrorCode,
} from "@ega/application";
import type {
  CreateObligationResponse,
  CreateObligationTemplateRequest,
  GenerateObligationsResponse,
  GetObligationResponse,
  ListObligationsResponse,
  ListObligationTemplatesResponse,
  ObligationSummaryResponse,
  ObligationTemplateResponse,
  UpdateObligationResponse,
} from "@ega/contracts/money";
import { SupabaseObligationRepository } from "@ega/data-access";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

type MoneyContext = Context<{ Variables: ServerVariables }>;

const VALIDATION_MESSAGE = "Request body must be valid JSON.";

/**
 * Map the application's small error vocabulary onto the Money transport
 * envelope: validation -> 400, not found -> 404, stale/illegal lifecycle ->
 * 409 and anything unexpected -> 500. The bearer middleware owns 401.
 */
function errorResponse(
  c: MoneyContext,
  code: ApplicationErrorCode | undefined,
  message: string,
) {
  if (code === "validation") {
    return c.json({ error: { code: "VALIDATION", message } }, 400);
  }
  if (code === "notFound") {
    return c.json({ error: { code: "NOT_FOUND", message } }, 404);
  }
  if (code === "forbidden") {
    return c.json({ error: { code: "FORBIDDEN", message } }, 403);
  }
  if (code === "conflict") {
    return c.json({ error: { code: "CONFLICT", message } }, 409);
  }
  return c.json({ error: { code: "INTERNAL", message } }, 500);
}

function repository(c: MoneyContext): SupabaseObligationRepository {
  return new SupabaseObligationRepository(c.var.client);
}

/**
 * Authenticated Money obligation transport (MONEY-06).
 *
 * Request-scoped Supabase + RLS remains authoritative for owner isolation; the
 * actor comes only from the verified bearer middleware. Bills and subscriptions
 * are the same occurrence rows filtered by `kind` — there is no second paid
 * flag or second resource. Scheduling, editing and cancelling never post cash;
 * only the MONEY-07 atomic payment path does.
 */
export function createMoneyRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  /* ------------------------------ occurrences ----------------------------- */

  routes.get("/obligations", async (c) => {
    const { actor } = c.var;
    const result = await listObligations(actor, repository(c), c.req.query());
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }
    const response: ListObligationsResponse = {
      ok: true,
      obligations: result.data.occurrences,
      pagination: result.data.pagination,
    };
    return c.json(response);
  });

  routes.get("/obligations/summary", async (c) => {
    const { actor } = c.var;
    const result = await getObligationSummary(actor, repository(c), c.req.query());
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }
    const response: ObligationSummaryResponse = {
      ok: true,
      summary: result.data,
    };
    return c.json(response);
  });

  routes.post("/obligations", async (c) => {
    const { actor } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json(
        { error: { code: "VALIDATION", message: VALIDATION_MESSAGE } },
        400,
      );
    }
    const result = await createObligation(actor, repository(c), body);
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }
    const response: CreateObligationResponse = {
      ok: true,
      obligation: result.data.occurrence,
      replayed: result.data.replayed,
    };
    return c.json(response, result.data.replayed ? 200 : 201);
  });

  routes.get("/obligations/:id", async (c) => {
    const { actor } = c.var;
    const result = await getObligation(
      actor,
      repository(c),
      c.req.param("id"),
    );
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }
    const response: GetObligationResponse = {
      ok: true,
      obligation: result.data,
    };
    return c.json(response);
  });

  routes.patch("/obligations/:id", async (c) => {
    const { actor } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json(
        { error: { code: "VALIDATION", message: VALIDATION_MESSAGE } },
        400,
      );
    }
    const result = await updateObligation(
      actor,
      repository(c),
      c.req.param("id"),
      body,
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }
    const response: UpdateObligationResponse = {
      ok: true,
      obligation: result.data,
    };
    return c.json(response);
  });

  routes.post("/obligations/:id/transition", async (c) => {
    const { actor } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json(
        { error: { code: "VALIDATION", message: VALIDATION_MESSAGE } },
        400,
      );
    }
    const result = await transitionObligation(
      actor,
      repository(c),
      c.req.param("id"),
      body,
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }
    const response: UpdateObligationResponse = {
      ok: true,
      obligation: result.data,
    };
    return c.json(response);
  });

  /* ------------------------------- templates ------------------------------ */

  routes.get("/obligation-templates", async (c) => {
    const { actor } = c.var;
    const raw = c.req.query();
    let includeArchived: boolean | undefined;
    if (raw.includeArchived !== undefined) {
      if (raw.includeArchived === "true") includeArchived = true;
      else if (raw.includeArchived === "false") includeArchived = false;
      else {
        return c.json(
          {
            error: {
              code: "VALIDATION",
              message: "includeArchived must be true or false.",
            },
          },
          400,
        );
      }
    }
    const result = await listObligationTemplates(actor, repository(c), {
      ...raw,
      includeArchived,
    });
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }
    const response: ListObligationTemplatesResponse = {
      ok: true,
      templates: result.data.templates,
    };
    return c.json(response);
  });

  routes.post("/obligation-templates", async (c) => {
    const { actor } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json(
        { error: { code: "VALIDATION", message: VALIDATION_MESSAGE } },
        400,
      );
    }
    const result = await createObligationTemplate(
      actor,
      repository(c),
      body as unknown as CreateObligationTemplateRequest,
    );
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }
    const response: ObligationTemplateResponse = {
      ok: true,
      template: result.data,
    };
    return c.json(response, 201);
  });

  routes.get("/obligation-templates/:id", async (c) => {
    const { actor } = c.var;
    const result = await getObligationTemplate(
      actor,
      repository(c),
      c.req.param("id"),
    );
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }
    const response: ObligationTemplateResponse = {
      ok: true,
      template: result.data,
    };
    return c.json(response);
  });

  routes.patch("/obligation-templates/:id", async (c) => {
    const { actor } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json(
        { error: { code: "VALIDATION", message: VALIDATION_MESSAGE } },
        400,
      );
    }
    const result = await updateObligationTemplate(
      actor,
      repository(c),
      c.req.param("id"),
      body,
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }
    const response: ObligationTemplateResponse = {
      ok: true,
      template: result.data,
    };
    return c.json(response);
  });

  routes.post("/obligation-templates/:id/generate", async (c) => {
    const { actor } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json(
        { error: { code: "VALIDATION", message: VALIDATION_MESSAGE } },
        400,
      );
    }
    const result = await generateObligations(actor, repository(c), {
      templateId: c.req.param("id"),
      throughDate: body.throughDate,
    });
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }
    const response: GenerateObligationsResponse = {
      ok: true,
      templateId: result.data.templateId,
      throughDate: result.data.throughDate,
      created: result.data.created,
      existing: result.data.existing,
      occurrences: result.data.occurrences,
      truncated: result.data.truncated,
    };
    return c.json(response);
  });

  return routes;
}
