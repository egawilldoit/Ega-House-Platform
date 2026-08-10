import { Hono } from "hono";

import { getTodayReadModel } from "@ega/application";
import { SupabaseTasksRepository } from "@ega/data-access";

import type { ServerVariables } from "../app";

export function createTodayRoutes(): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const result = await getTodayReadModel(
      actor,
      new SupabaseTasksRepository(client),
      c.req.query("date"),
    );

    if (!result.ok) {
      return c.json(
        { error: { code: "VALIDATION", message: result.errorMessage } },
        400,
      );
    }

    return c.json(result.data);
  });

  return routes;
}
