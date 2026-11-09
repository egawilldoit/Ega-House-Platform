import { Hono } from "hono";

import {
  createDailyCheckinService,
} from "@ega/application";
import type {
  GetDailyCheckinResponse,
  SaveDailyCheckinRequest,
  SaveDailyCheckinResponse,
} from "@ega/contracts/checkins";
import { SupabaseDailyCheckinRepository } from "@ega/data-access";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

/**
 * Authenticated daily check-in transport (PO-15, issue #360). One canonical
 * owner/day record; partial saves merge so concurrent clients cannot erase
 * each other's fields. Owner identity is derived from the bearer token.
 */
export function createCheckinsRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const localDate = c.req.query("localDate") ?? "";
    const timezone = c.req.query("timezone") ?? "UTC";
    const service = createDailyCheckinService(new SupabaseDailyCheckinRepository(client));
    const result = await service.getDailyCheckin(actor, localDate, timezone);
    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }
    const response: GetDailyCheckinResponse = { ok: true, checkin: result.data };
    return c.json(response);
  });

  routes.post("/", async (c) => {
    const { actor, client } = c.var;
    const body = (await readJsonBody(c)) as SaveDailyCheckinRequest | null;
    if (!body || typeof body !== "object") {
      return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    }
    const service = createDailyCheckinService(new SupabaseDailyCheckinRepository(client));
    const result = await service.saveDailyCheckin(actor, {
      localDate: String(body.localDate ?? ""),
      timezone: String(body.timezone ?? ""),
      patch: (body.patch ?? {}) as never,
    });
    if (!result.ok) {
      const status = result.code === "forbidden" ? 403 : result.code === "validation" ? 400 : 500;
      return c.json({ error: { code: "SAVE_FAILED", message: result.errorMessage } }, status);
    }
    const response: SaveDailyCheckinResponse = {
      ok: true,
      checkin: result.data.checkin,
      overtimeAdvisory: result.data.overtimeAdvisory,
    };
    return c.json(response);
  });

  void dependencies;
  return routes;
}
