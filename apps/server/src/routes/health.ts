import { Hono } from "hono";

import { getHealthWorkloadSnapshot } from "@ega/application/health/workload-snapshot";
import { getHealthRecommendations } from "@ega/application/health/recommendations";
import type { HealthSnapshotResponse } from "@ega/contracts/health";
import { SupabaseExecutionEvidenceRepository, SupabaseTimeContextRepository } from "@ega/data-access";

import type { ServerDependencies, ServerVariables } from "../app";

export function createHealthRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/snapshot", async (c) => {
    const { actor, client } = c.var;
    const now = dependencies.now?.() ?? new Date();
    const timezone = c.req.query("timezone");
    const includeOpenRaw = c.req.query("includeOpenSessions");
    const includeOpenSessions = includeOpenRaw === "true";

    const result = await getHealthWorkloadSnapshot(
      actor,
      new SupabaseTimeContextRepository(client),
      new SupabaseExecutionEvidenceRepository(client),
      {
        now,
        requestedTimezone: timezone,
        includeOpenSessions,
      },
    );

    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }

    const snapshot = result.data;
    const recommendations = getHealthRecommendations(snapshot);

    const payload: HealthSnapshotResponse = {
      ok: true,
      snapshot: {
        generatedAt: snapshot.generatedAt,
        window: snapshot.window,
        timezone: snapshot.timezone,
        requestedTimezone: snapshot.requestedTimezone,
        fallback: snapshot.fallback,
        localDate: snapshot.localDate,
        rollingWorkload: snapshot.rollingWorkload,
        activeDays: snapshot.activeDays,
        windowDays: snapshot.windowDays,
        sessionCount: snapshot.sessionCount,
        sessionDensity: snapshot.sessionDensity,
        longestSessionSeconds: snapshot.longestSessionSeconds,
        longestSessionLabel: snapshot.longestSessionLabel,
        averageSessionSeconds: snapshot.averageSessionSeconds,
        averageSessionLabel: snapshot.averageSessionLabel,
        quality: snapshot.quality,
      },
      recommendations: recommendations.map((r) => ({
        id: r.id,
        kind: r.kind,
        severity: r.severity,
        copyKey: r.copyKey,
        title: r.title,
        message: r.message,
        evidence: r.evidence,
      })),
    };

    return c.json(payload);
  });

  return routes;
}
