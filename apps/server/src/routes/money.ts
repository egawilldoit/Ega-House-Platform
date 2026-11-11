import { Hono } from "hono";
import type { Context } from "hono";

import {
  createMovement,
  getMoneyState,
  getMovement,
  listMovements,
  resolveTimeContext,
  updateMovement,
  type ApplicationErrorCode,
} from "@ega/application";
import type {
  CreateMovementResponse,
  GetMoneyStateResponse,
  GetMovementResponse,
  ListMovementsResponse,
  UpdateMovementResponse,
} from "@ega/contracts/money";
import { SupabaseMoneyRepository, SupabaseTimeContextRepository } from "@ega/data-access";
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

/**
 * Authenticated movement transport (MONEY-04) beside the existing expense
 * routes. Request-scoped Supabase + RLS remains authoritative for owner
 * isolation; the actor comes only from the verified bearer middleware.
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
    const result = await createMovement(actor, new SupabaseMoneyRepository(client), body);
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
    const result = await getMovement(actor, new SupabaseMoneyRepository(client), c.req.param("id"));
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
      { now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: UpdateMovementResponse = { ok: true, movement: result.data };
    return c.json(response);
  });

  routes.get("/state", async (c) => {
    const { actor, client } = c.var;
    const rawQuery = c.req.query();
    const resolved = await resolveTimezone(c, queryValue(rawQuery.timezone)?.trim() || undefined);
    if (!resolved.ok) return resolved.response;

    const result = await getMoneyState(
      actor,
      new SupabaseMoneyRepository(client),
      rawQuery,
      { timezone: resolved.timezone, now: dependencies.now?.() ?? new Date() },
    );
    if (!result.ok) return errorResponse(c, result.code, result.errorMessage);
    const response: GetMoneyStateResponse = { ok: true, state: result.data.state };
    return c.json(response);
  });

  return routes;
}
