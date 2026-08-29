import { Hono } from "hono";

import { getFrictionRadarReadModel, resolveFrictionEvidenceWindow } from "@ega/application";
import type { FrictionRadarResponse } from "@ega/contracts/friction";
import { SupabaseExecutionEvidenceRepository, SupabaseFrictionRepository, SupabaseTimeContextRepository } from "@ega/data-access";
import { FRICTION_NEGLECTED_GOAL_WINDOW_DAYS } from "@ega/domain/friction";

import type { ServerDependencies, ServerVariables } from "../app";

export function createFrictionRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/radar", async (c) => {
    const { actor, client } = c.var;
    const now = dependencies.now?.() ?? new Date();

    // Derive evidence window as rolling 14-day local window (EGA-498).
    // Uses shared Time Context resolver and canonical day windows so the
    // neglected-goal window is rolling, not calendar-week Monday→now,
    // and remains correct across Tokyo/New York/DST and server TZ independence.
    let evidenceWindow: { startIso: string; endIso: string };
    try {
      const tzRepo = new SupabaseTimeContextRepository(client);
      const windowResult = await resolveFrictionEvidenceWindow(actor, tzRepo, { now });
      if (windowResult.ok) {
        evidenceWindow = { startIso: windowResult.data.startIso, endIso: windowResult.data.endIso };
      } else {
        throw new Error(windowResult.errorMessage);
      }
    } catch {
      // Fallback to UTC 14-day rolling window if time-context resolution fails.
      const start = new Date(now.getTime() - FRICTION_NEGLECTED_GOAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
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
