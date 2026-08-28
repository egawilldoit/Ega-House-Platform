import { Hono } from "hono";

import { resolveTimeContext } from "@ega/application";
import type { GetTimeContextResponse } from "@ega/contracts/time-context";
import { SupabaseTimeContextRepository } from "@ega/data-access";
import { getLocalDayWindow, getWeekWindow } from "@ega/domain";

import type { ServerDependencies, ServerVariables } from "../app";

/**
 * Canonical Time Context transport — GET only.
 *
 * Authenticated GET /api/time-context resolves the caller's effective
 * Time Context via application use case `resolveTimeContext`. The actor is
 * derived solely from the verified bearer token (c.var.actor) and the
 * request-scoped Supabase client (c.var.client) carrying the same token, so
 * RLS remains authoritative and client-supplied owner IDs are never trusted.
 *
 * Query params:
 *   - `timezone` | `requestedTimezone` — optional IANA zone the caller wants
 *     to evaluate. When omitted, the persisted timezone for the authenticated
 *     owner (user_time_context) is used; missing/invalid falls back to UTC
 *     with an explicit `fallback` flag per domain semantics.
 *   - `date` — optional explicit local date (YYYY-MM-DD) for historical
 *     reproducibility. When supplied, day/week windows are computed for that
 *     local date in the effective timezone instead of deriving localDate from
 *     `now`. Invalid dates answer 400 VALIDATION. Absent `date` resolves
 *     windows for `now` (injected via dependencies.now for determinism).
 *
 * PUT / PATCH for timezone mutation is intentionally NOT exposed here.
 * Device-timezone auto-persistence remains a human-in-the-loop policy
 * decision (HITL). The persistence helper `setTimeContextTimezone` is covered
 * by application/data-access tests but transport mutation stays gated until
 * policy is approved. This route is read-only.
 */
export function createTimeContextRoutes(
  dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;

    const rawTimezone =
      c.req.query("timezone") ?? c.req.query("requestedTimezone") ?? null;
    const requestedTimezone =
      typeof rawTimezone === "string" && rawTimezone.trim().length > 0
        ? rawTimezone.trim()
        : null;

    const rawDate = c.req.query("date");
    const dateParam =
      typeof rawDate === "string" && rawDate.trim().length > 0
        ? rawDate.trim()
        : null;
    const hasDate = dateParam !== null;

    if (hasDate) {
      try {
        getLocalDayWindow("UTC", dateParam);
      } catch (error) {
        const message =
          error instanceof Error && error.message.includes("Invalid date")
            ? "Date is invalid. Expected YYYY-MM-DD."
            : "Date is invalid. Expected YYYY-MM-DD.";
        return c.json(
          { error: { code: "VALIDATION", message } },
          400,
        );
      }
    }

    const repository = new SupabaseTimeContextRepository(
      client as never,
    );

    const now = dependencies.now?.() ?? new Date();

    const result = await resolveTimeContext(actor, repository, {
      requestedTimezone: requestedTimezone ?? undefined,
      now,
    });

    if (!result.ok) {
      return c.json(
        { error: { code: "INTERNAL", message: result.errorMessage } },
        500,
      );
    }

    let resolved = result.data;

    if (hasDate) {
      try {
        const dayWindowRaw = getLocalDayWindow(resolved.timezone, dateParam);
        const weekWindowRaw = getWeekWindow(resolved.timezone, dateParam);
        const dayWindow = {
          ...dayWindowRaw,
          timezone: resolved.timezone,
          requestedTimezone: resolved.requestedTimezone,
          fallback: resolved.fallback,
        };
        const weekWindow = {
          ...weekWindowRaw,
          timezone: resolved.timezone,
          requestedTimezone: resolved.requestedTimezone,
          fallback: resolved.fallback,
        };
        resolved = {
          timezone: resolved.timezone,
          requestedTimezone: resolved.requestedTimezone,
          fallback: resolved.fallback,
          localDate: dateParam,
          dayWindow,
          weekWindow,
        };
      } catch (error) {
        const message =
          error instanceof Error && error.message.includes("Invalid date")
            ? "Date is invalid. Expected YYYY-MM-DD."
            : "Unable to resolve time window.";
        return c.json(
          { error: { code: "VALIDATION", message } },
          400,
        );
      }
    }

    const response: GetTimeContextResponse = {
      ok: true,
      timeContext: {
        timezone: resolved.timezone,
        requestedTimezone: resolved.requestedTimezone,
        fallback: resolved.fallback,
        localDate: resolved.localDate,
        dayWindow: {
          date: resolved.dayWindow.date,
          timezone: resolved.dayWindow.timezone,
          requestedTimezone: resolved.dayWindow.requestedTimezone,
          fallback: resolved.dayWindow.fallback,
          startUtc: resolved.dayWindow.startUtcIso,
          endUtc: resolved.dayWindow.endUtcIso,
          durationHours: resolved.dayWindow.durationHours,
        },
        weekWindow: {
          date: resolved.weekWindow.date,
          timezone: resolved.weekWindow.timezone,
          requestedTimezone: resolved.weekWindow.requestedTimezone,
          fallback: resolved.weekWindow.fallback,
          weekStart: resolved.weekWindow.weekStart,
          weekEnd: resolved.weekWindow.weekEnd,
          weekStartUtc: resolved.weekWindow.weekStartUtcIso,
          weekEndExclusiveUtc: resolved.weekWindow.weekEndExclusiveUtcIso,
        },
      },
    };

    return c.json(response);
  });

  return routes;
}
