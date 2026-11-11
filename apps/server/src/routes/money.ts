import { Hono } from "hono";
import type { Context } from "hono";

import {
  classifyMoneyExpense,
  deleteMoneyCoffeeVisit,
  getMoneyBudgetPlan,
  getMoneyCoffeeWindow,
  listMoneyCoffeeVisits,
  patchMoneyBudgetPlan,
  recordMoneyCoffeeVisit,
  saveMoneyBudgetPlan,
  type ApplicationErrorCode,
} from "@ega/application";
import type {
  ClassifyMoneyExpenseResponse,
  DeleteMoneyCoffeeVisitResponse,
  GetMoneyBudgetPlanResponse,
  ListMoneyCoffeeVisitsResponse,
  MoneyBudgetMutationResponse,
  MoneyCoffeeWindowResponse,
  RecordMoneyCoffeeVisitResponse,
} from "@ega/contracts/money";
import {
  SupabaseExpenseRepository,
  SupabaseMoneyBudgetRepository,
  SupabaseMoneyCoffeeRepository,
} from "@ega/data-access";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

type MoneyContext = Context<{ Variables: ServerVariables }>;

const VALIDATION_MESSAGE = "Request body must be valid JSON.";

/**
 * MONEY-05 transport: versioned period budget plans, explicit category
 * classification and counted coffee visits. Owner identity comes only from the
 * verified bearer middleware; request-scoped Supabase + RLS remains
 * authoritative for isolation.
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

function queryValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  const raw = queryValue(value)?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function createMoneyRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/budget", async (c) => {
    const { actor, client } = c.var;
    const raw = c.req.query();
    const result = await getMoneyBudgetPlan(
      actor,
      new SupabaseMoneyBudgetRepository(client),
      {
        periodStartDate: queryValue(raw.periodStartDate),
        periodEndDate: queryValue(raw.periodEndDate),
      },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: GetMoneyBudgetPlanResponse = {
      ok: true,
      plan: result.data,
    };
    return c.json(response);
  });

  routes.put("/budget", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }
    const result = await saveMoneyBudgetPlan(
      actor,
      new SupabaseMoneyBudgetRepository(client),
      body,
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: MoneyBudgetMutationResponse = { ok: true, plan: result.data };
    return c.json(response);
  });

  routes.patch("/budget", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }
    const result = await patchMoneyBudgetPlan(
      actor,
      new SupabaseMoneyBudgetRepository(client),
      body,
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: MoneyBudgetMutationResponse = { ok: true, plan: result.data };
    return c.json(response);
  });

  routes.get("/coffee-visits", async (c) => {
    const { actor, client } = c.var;
    const raw = c.req.query();
    const result = await listMoneyCoffeeVisits(
      actor,
      new SupabaseMoneyCoffeeRepository(client),
      {
        from: queryValue(raw.from),
        to: queryValue(raw.to),
        limit: optionalInteger(raw.limit),
        offset: optionalInteger(raw.offset),
      },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: ListMoneyCoffeeVisitsResponse = {
      ok: true,
      visits: result.data.visits,
    };
    return c.json(response);
  });

  routes.post("/coffee-visits", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }
    const result = await recordMoneyCoffeeVisit(
      actor,
      {
        expenses: new SupabaseExpenseRepository(client),
        coffee: new SupabaseMoneyCoffeeRepository(client),
      },
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

  routes.delete("/coffee-visits/:id", async (c) => {
    const { actor, client } = c.var;
    const result = await deleteMoneyCoffeeVisit(
      actor,
      new SupabaseMoneyCoffeeRepository(client),
      {
        id: c.req.param("id"),
        version: optionalInteger(c.req.query("version")),
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
    const { actor, client } = c.var;
    const raw = c.req.query();
    const result = await getMoneyCoffeeWindow(
      actor,
      {
        expenses: new SupabaseExpenseRepository(client),
        coffee: new SupabaseMoneyCoffeeRepository(client),
      },
      {
        localDate: queryValue(raw.localDate),
        timezone: queryValue(raw.timezone),
        periodStartDate: queryValue(raw.periodStartDate),
        periodEndDate: queryValue(raw.periodEndDate),
        spendLimitMinor: optionalInteger(raw.spendLimitMinor),
        visitLimitMinor: optionalInteger(raw.visitLimitMinor),
      },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: MoneyCoffeeWindowResponse = {
      ok: true,
      coffee: result.data,
    };
    return c.json(response);
  });

  routes.post("/classify", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }
    const result = await classifyMoneyExpense(
      actor,
      {
        expenses: new SupabaseExpenseRepository(client),
        coffee: new SupabaseMoneyCoffeeRepository(client),
      },
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
