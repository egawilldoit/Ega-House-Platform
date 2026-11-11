import { Hono } from "hono";
import type { Context } from "hono";

import {
<<<<<<< HEAD
  classifyMoneyExpense,
  createMoneyPeriod,
  createMovement,
  deleteMoneyCoffeeVisit,
  getMoneyBudgetPlan,
  getMoneyCoffeeWindow,
  getMoneyState,
  getMovement,
  getTimeContextTimezone,
  listMoneyCoffeeVisits,
  listMovements,
  patchMoneyBudgetPlan,
  recordMoneyCoffeeVisit,
  resolveTimeContext,
  saveMoneyBudgetPlan,
  updateMoneySettings,
  updateMovement,
  type ApplicationErrorCode,
  type AuthenticatedActor,
} from "@ega/application";
import type {
  ClassifyMoneyExpenseResponse,
  CreateMoneyPeriodResponse,
  CreateMovementResponse,
  DeleteMoneyCoffeeVisitResponse,
  GetMoneyBudgetPlanResponse,
  GetMoneyStateResponse,
  GetMovementResponse,
  ListMoneyCoffeeVisitsResponse,
  ListMovementsResponse,
  MoneyBudgetMutationResponse,
  MoneyCoffeeWindowResponse,
  RecordMoneyCoffeeVisitResponse,
  UpdateMoneySettingsResponse,
  UpdateMovementResponse,
} from "@ega/contracts/money";
import {
  SupabaseExpenseRepository,
  SupabaseMoneyBudgetRepository,
  SupabaseMoneyCoffeeRepository,
  SupabaseMoneyPeriodRepository,
  SupabaseMoneyRepository,
  SupabaseTimeContextRepository,
} from "@ega/data-access";
import { isValidIANATimeZone } from "@ega/domain";
=======
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
>>>>>>> origin/feat/money-06-obligations

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

type MoneyContext = Context<{ Variables: ServerVariables }>;

const VALIDATION_MESSAGE = "Request body must be valid JSON.";

<<<<<<< HEAD
=======
/**
 * Map the application's small error vocabulary onto the Money transport
 * envelope: validation -> 400, not found -> 404, stale/illegal lifecycle ->
 * 409 and anything unexpected -> 500. The bearer middleware owns 401.
 */
>>>>>>> origin/feat/money-06-obligations
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

<<<<<<< HEAD
function queryValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function ownerTimezone(
  actor: AuthenticatedActor,
  repository: SupabaseTimeContextRepository,
): Promise<string | null> {
  const timezone = await getTimeContextTimezone(actor, repository);
  if (!timezone.ok) {
    throw new Error("Unable to load the owner time context.");
  }
  return timezone.data;
}

/**
 * Authenticated Money transport.
 *
 * Period setup/state (MONEY-03) and movement create/read/update (MONEY-04)
 * share the same canonical application use cases as the web and MCP surfaces.
 * Owner identity comes only from the verified bearer middleware; request
 * bodies and queries can select a period or date, never an owner or currency.
 * RLS remains authoritative.
=======
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
>>>>>>> origin/feat/money-06-obligations
 */
export function createMoneyRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

<<<<<<< HEAD
  async function resolveTimezone(
    c: MoneyContext,
    explicit: string | undefined,
  ): Promise<{ ok: true; timezone: string | null } | { ok: false; response: Response }> {
    if (explicit) {
      if (!isValidIANATimeZone(explicit)) {
        return {
          ok: false,
          response: c.json(
            { error: { code: "VALIDATION", message: "Timezone must be a valid IANA timezone." } },
            400,
          ),
        };
      }
      return { ok: true, timezone: explicit };
    }
    const timeContext = await resolveTimeContext(
      c.var.actor,
      new SupabaseTimeContextRepository(c.var.client),
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!timeContext.ok) {
      return {
        ok: false,
        response: c.json(
          { error: { code: "INTERNAL", message: timeContext.errorMessage } },
          500,
        ),
      };
    }
    return { ok: true, timezone: timeContext.data.timezone };
  }

  routes.get("/state", async (c) => {
    const { actor, client } = c.var;
    try {
      const timezone = await ownerTimezone(
        actor,
        new SupabaseTimeContextRepository(client),
      );
      const rawQuery = c.req.query();
      const result = await getMoneyState(
        actor,
        new SupabaseMoneyPeriodRepository(client),
        {
          periodId: rawQuery.periodId,
          date: rawQuery.date,
          mode: rawQuery.mode,
        },
        { now: dependencies.now?.() ?? new Date(), timezone },
      );
      if (!result.ok) {
        return errorResponse(c, result.code, result.errorMessage);
      }
      const response: GetMoneyStateResponse = { ok: true, ...result.data };
      return c.json(response);
    } catch {
      return c.json(
        { error: { code: "INTERNAL", message: "Unable to load Money state right now." } },
        500,
      );
    }
  });

  routes.post("/periods", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }
    try {
      const timezone = await ownerTimezone(
        actor,
        new SupabaseTimeContextRepository(client),
      );
      const result = await createMoneyPeriod(
        actor,
        new SupabaseMoneyPeriodRepository(client),
        body,
        {
          now: dependencies.now?.() ?? new Date(),
          timezone,
          surface: "web",
        },
      );
      if (!result.ok) {
        return errorResponse(c, result.code, result.errorMessage);
      }
      const response: CreateMoneyPeriodResponse = {
        ok: true,
        period: result.data.period,
        replayed: result.data.replayed,
      };
      return c.json(response, result.data.replayed ? 200 : 201);
    } catch {
      return c.json(
        { error: { code: "INTERNAL", message: "Unable to create the Money period right now." } },
        500,
      );
    }
  });

  routes.patch("/periods/:id/settings", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }
    try {
      const timezone = await ownerTimezone(
        actor,
        new SupabaseTimeContextRepository(client),
      );
      const result = await updateMoneySettings(
        actor,
        new SupabaseMoneyPeriodRepository(client),
        c.req.param("id"),
        body,
        { now: dependencies.now?.() ?? new Date(), timezone },
      );
      if (!result.ok) {
        return errorResponse(c, result.code, result.errorMessage);
      }
      const response: UpdateMoneySettingsResponse = {
        ok: true,
        period: result.data,
      };
      return c.json(response);
    } catch {
      return c.json(
        { error: { code: "INTERNAL", message: "Unable to save Money settings right now." } },
        500,
      );
    }
  });

  routes.get("/movements", async (c) => {
    const { actor, client } = c.var;
    const rawQuery = c.req.query();
    const resolved = await resolveTimezone(c, queryValue(rawQuery.timezone)?.trim() || undefined);
    if (!resolved.ok) return resolved.response;

    const result = await listMovements(
      actor,
      new SupabaseMoneyRepository(client),
      rawQuery,
      { timezone: resolved.timezone, now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);

    const response: ListMovementsResponse = {
      ok: true,
      movements: result.data.movements,
      pagination: result.data.pagination,
      cutoff: result.data.cutoff,
      timezone: result.data.timezone,
=======
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
>>>>>>> origin/feat/money-06-obligations
    };
    return c.json(response);
  });

<<<<<<< HEAD
  routes.post("/movements", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }
    const result = await createMovement(
      actor,
      new SupabaseMoneyRepository(client),
      body,
      { periods: new SupabaseMoneyPeriodRepository(client) },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);

    const response: CreateMovementResponse = {
      ok: true,
      movement: result.data.movement,
=======
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
>>>>>>> origin/feat/money-06-obligations
      replayed: result.data.replayed,
    };
    return c.json(response, result.data.replayed ? 200 : 201);
  });

<<<<<<< HEAD
  routes.get("/movements/:id", async (c) => {
    const { actor, client } = c.var;
    const result = await getMovement(
      actor,
      new SupabaseMoneyRepository(client),
      c.req.param("id"),
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: GetMovementResponse = { ok: true, movement: result.data };
    return c.json(response);
  });

  routes.patch("/movements/:id", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }
    const result = await updateMovement(
      actor,
      new SupabaseMoneyRepository(client),
      c.req.param("id"),
      body,
      {
        periods: new SupabaseMoneyPeriodRepository(client),
        now: dependencies.now?.() ?? new Date(),
      },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: UpdateMovementResponse = { ok: true, movement: result.data };
    return c.json(response);
  });

  // MONEY-05: period budget plan. The canonical period row owns its dates; the
  // plan owns allocations, targets and coffee limits with version fencing.
  function budgetDependencies(c: MoneyContext) {
    return {
      budgets: new SupabaseMoneyBudgetRepository(c.var.client),
      periods: new SupabaseMoneyPeriodRepository(c.var.client),
    };
  }

  routes.get("/budget", async (c) => {
    const result = await getMoneyBudgetPlan(
      c.var.actor,
      budgetDependencies(c),
      c.req.query(),
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: GetMoneyBudgetPlanResponse = { ok: true, plan: result.data };
    return c.json(response);
  });

  routes.put("/budget", async (c) => {
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }
    const result = await saveMoneyBudgetPlan(
      c.var.actor,
      budgetDependencies(c),
      body,
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: MoneyBudgetMutationResponse = { ok: true, plan: result.data };
    return c.json(response, result.data.version === 1 ? 201 : 200);
  });

  routes.patch("/budget", async (c) => {
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }
    const result = await patchMoneyBudgetPlan(
      c.var.actor,
      budgetDependencies(c),
      body,
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: MoneyBudgetMutationResponse = { ok: true, plan: result.data };
    return c.json(response);
  });

  // Counted coffee visits reference canonical expenses; no second cash effect.
  function coffeeDependencies(c: MoneyContext) {
    return {
      expenses: new SupabaseExpenseRepository(c.var.client),
      coffee: new SupabaseMoneyCoffeeRepository(c.var.client),
    };
  }

  routes.post("/coffee-visits", async (c) => {
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }
    const result = await recordMoneyCoffeeVisit(
      c.var.actor,
      coffeeDependencies(c),
      body,
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: RecordMoneyCoffeeVisitResponse = {
      ok: true,
      visit: result.data.visit,
      replayed: result.data.replayed,
    };
    return c.json(response, result.data.replayed ? 200 : 201);
  });

  routes.get("/coffee-visits", async (c) => {
    const result = await listMoneyCoffeeVisits(
      c.var.actor,
      new SupabaseMoneyCoffeeRepository(c.var.client),
      c.req.query(),
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: ListMoneyCoffeeVisitsResponse = {
      ok: true,
      visits: result.data.visits,
    };
    return c.json(response);
  });

  routes.delete("/coffee-visits/:id", async (c) => {
    const rawVersion = c.req.query("version");
    const result = await deleteMoneyCoffeeVisit(
      c.var.actor,
      new SupabaseMoneyCoffeeRepository(c.var.client),
      {
        id: c.req.param("id"),
        version: rawVersion === undefined ? undefined : Number(rawVersion),
      },
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: DeleteMoneyCoffeeVisitResponse = {
      ok: true,
      id: result.data.id,
      alreadyDeleted: result.data.alreadyDeleted,
    };
    return c.json(response);
  });

  routes.get("/coffee-window", async (c) => {
    const result = await getMoneyCoffeeWindow(
      c.var.actor,
      coffeeDependencies(c),
      c.req.query(),
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: MoneyCoffeeWindowResponse = { ok: true, coffee: result.data };
    return c.json(response);
  });

  routes.post("/classify", async (c) => {
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }
    const result = await classifyMoneyExpense(
      c.var.actor,
      coffeeDependencies(c),
      body,
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: ClassifyMoneyExpenseResponse = {
      ok: true,
      expense: result.data.expense,
      previousCategory: result.data.previousCategory,
      countedCoffeeVisitIds: result.data.countedCoffeeVisitIds,
      countedCoffeeUsageChanged: result.data.countedCoffeeUsageChanged,
=======
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
>>>>>>> origin/feat/money-06-obligations
    };
    return c.json(response);
  });

  return routes;
}
