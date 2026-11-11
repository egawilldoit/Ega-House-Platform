import { Hono } from "hono";
import type { Context } from "hono";

import {
  createMoneyPeriod,
  getMoneyState,
  getTimeContextTimezone,
  updateMoneySettings,
  type ApplicationErrorCode,
  type AuthenticatedActor,
} from "@ega/application";
import type {
  CreateMoneyPeriodResponse,
  GetMoneyStateResponse,
  UpdateMoneySettingsResponse,
} from "@ega/contracts/money";
import {
  SupabaseMoneyPeriodRepository,
  SupabaseTimeContextRepository,
} from "@ega/data-access";

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
 * Authenticated Money period transport (MONEY-03). Owner identity comes only
 * from the verified bearer middleware; request bodies and queries can select a
 * period or date, never an owner or currency. RLS remains authoritative.
 */
export function createMoneyRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

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

  return routes;
}
