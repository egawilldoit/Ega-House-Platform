import { Hono } from "hono";
import type { Context } from "hono";

import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  resolveTimeContext,
  updateExpense,
  type ApplicationErrorCode,
} from "@ega/application";
import type {
  CreateExpenseResponse,
  DeleteExpenseResponse,
  GetExpenseResponse,
  ListExpensesResponse,
  UpdateExpenseResponse,
} from "@ega/contracts/expenses";
import { SupabaseExpenseRepository, SupabaseTimeContextRepository } from "@ega/data-access";
import { isValidIANATimeZone } from "@ega/domain";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

type ExpenseContext = Context<{ Variables: ServerVariables }>;

const VALIDATION_MESSAGE = "Request body must be valid JSON.";

/**
 * Map the application's small error vocabulary onto the expense transport
 * envelope: validation -> 400, not found -> 404, stale/duplicate -> 409 and
 * anything unexpected -> 500. The bearer middleware owns 401.
 */
function errorResponse(
  c: ExpenseContext,
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

/**
 * Authenticated expense ledger transport (PO-06 Slice A, issue #346).
 *
 * Request-scoped Supabase + RLS remains authoritative for owner isolation.
 * The actor comes only from the verified bearer middleware; no payload or
 * query value can select an owner. Local date windows use the owner's stored
 * time context unless the caller supplies an explicit IANA timezone.
 */
export function createExpensesRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const rawQuery = c.req.query();

    const explicitTimezone = queryValue(rawQuery.timezone)?.trim() ?? "";
    if (explicitTimezone && !isValidIANATimeZone(explicitTimezone)) {
      return c.json(
        { error: { code: "VALIDATION", message: "Timezone must be a valid IANA timezone." } },
        400,
      );
    }

    let resolvedTimezone: string | null = null;
    const hasWindow =
      queryValue(rawQuery.from) !== undefined ||
      queryValue(rawQuery.to) !== undefined;

    if (hasWindow && !explicitTimezone) {
      const timeContext = await resolveTimeContext(
        actor,
        new SupabaseTimeContextRepository(client),
        { now: dependencies.now?.() ?? new Date() },
      );
      if (!timeContext.ok) {
        return c.json(
          { error: { code: "INTERNAL", message: timeContext.errorMessage } },
          500,
        );
      }
      resolvedTimezone = timeContext.data.timezone;
    }

    const result = await listExpenses(
      actor,
      new SupabaseExpenseRepository(client),
      rawQuery,
      { timezone: resolvedTimezone },
    );
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }

    const response: ListExpensesResponse = {
      ok: true,
      expenses: result.data.expenses,
      pagination: result.data.pagination,
    };
    return c.json(response);
  });

  routes.post("/", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }

    const result = await createExpense(
      actor,
      new SupabaseExpenseRepository(client),
      body,
    );
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }

    const response: CreateExpenseResponse = {
      ok: true,
      expense: result.data.expense,
      replayed: result.data.replayed,
    };
    return c.json(response, result.data.replayed ? 200 : 201);
  });

  routes.get("/:id", async (c) => {
    const { actor, client } = c.var;
    const result = await getExpense(
      actor,
      new SupabaseExpenseRepository(client),
      c.req.param("id"),
    );
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }

    const response: GetExpenseResponse = { ok: true, expense: result.data };
    return c.json(response);
  });

  routes.patch("/:id", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: VALIDATION_MESSAGE } }, 400);
    }

    const result = await updateExpense(
      actor,
      new SupabaseExpenseRepository(client),
      c.req.param("id"),
      body,
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }

    const response: UpdateExpenseResponse = { ok: true, expense: result.data };
    return c.json(response);
  });

  routes.delete("/:id", async (c) => {
    const { actor, client } = c.var;
    const result = await deleteExpense(
      actor,
      new SupabaseExpenseRepository(client),
      c.req.param("id"),
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) {
      return errorResponse(c, result.code, result.errorMessage);
    }

    const response: DeleteExpenseResponse = {
      ok: true,
      id: result.data.id,
      deletedAt: result.data.deletedAt,
      alreadyDeleted: result.data.alreadyDeleted,
    };
    return c.json(response);
  });

  return routes;
}
