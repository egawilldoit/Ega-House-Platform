import { Hono } from "hono";
import type { Context } from "hono";

import {
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

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

type MoneyContext = Context<{ Variables: ServerVariables }>;

const VALIDATION_MESSAGE = "Request body must be valid JSON.";

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
 */
export function createMoneyRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

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
    };
    return c.json(response);
  });

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
      replayed: result.data.replayed,
    };
    return c.json(response, result.data.replayed ? 200 : 201);
  });

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
    };
    return c.json(response);
  });

  return routes;
}
