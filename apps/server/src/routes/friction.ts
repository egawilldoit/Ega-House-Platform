import { Hono } from "hono";

import { getFrictionRadarReadModel } from "@ega/application";
import type { FrictionRadarResponse } from "@ega/contracts/friction";
import { SupabaseExecutionEvidenceRepository, SupabaseFrictionRepository, SupabaseTimeContextRepository } from "@ega/data-access";
import { getLocalDateInTimezone, getWeekWindow } from "@ega/domain/time-context";

import type { ServerDependencies, ServerVariables } from "../app";

export function createFrictionRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/radar", async (c) => {
    const { actor, client } = c.var;
    const now = dependencies.now?.() ?? new Date();

    // Derive evidence window from EGA-523 time-context boundaries so
    // estimate-vs-actual and context-switch windows are bounded and
    // timezone-aware, not arbitrary ad-hoc dates.
    let timezone = "UTC";
    try {
      const tzRepo = new SupabaseTimeContextRepository(client);
      const tzResult = await tzRepo.getTimezone(actor);
      if (tzResult.ok && tzResult.value) {
        const candidate = String(tzResult.value).trim();
        if (candidate) timezone = candidate;
      }
    } catch {
      // Fallback to UTC — window remains bounded and deterministic.
    }

    let evidenceWindow: { startIso: string; endIso: string };
    try {
      const localDate = getLocalDateInTimezone(now, timezone);
      const week = getWeekWindow(timezone, localDate);
      evidenceWindow = { startIso: week.weekStartUtcIso, endIso: now.toISOString() };
    } catch {
      // If timezone/date derivation fails, fallback to 7-day UTC window.
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      evidenceWindow = { startIso: start.toISOString(), endIso: now.toISOString() };
    }

    const result = await getFrictionRadarReadModel(
      actor,
      new SupabaseFrictionRepository(client),
      {
        now,
        evidence: {
          window: evidenceWindow,
          repository: new SupabaseExecutionEvidenceRepository(client),
          includeOpenSessions: false,
          nowIso: now.toISOString(),
        },
      },
    );

    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }

    return c.json(result.data satisfies FrictionRadarResponse);
  });

  return routes;
}
