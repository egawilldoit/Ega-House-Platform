import { Hono } from "hono";

import { getFrictionRadarReadModel } from "@ega/application";
import type { FrictionRadarResponse } from "@ega/contracts/friction";
import { SupabaseFrictionRepository } from "@ega/data-access";

import type { ServerDependencies, ServerVariables } from "../app";

export function createFrictionRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/radar", async (c) => {
    const { actor, client } = c.var;

    const result = await getFrictionRadarReadModel(
      actor,
      new SupabaseFrictionRepository(client),
      { now: dependencies.now?.() },
    );

    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }

    return c.json(result.data satisfies FrictionRadarResponse);
  });

  return routes;
}
