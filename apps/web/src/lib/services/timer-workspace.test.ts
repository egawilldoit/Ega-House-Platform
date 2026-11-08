import assert from "node:assert/strict";
import test from "node:test";

import { getTimerWorkspaceData } from "./timer-service";

test("Timer Today includes more than 80 sessions and every query page", async () => {
  const sessions = Array.from({ length: 501 }, (_, index) => ({
    id: String(index).padStart(4, "0"), task_id: "task-1",
    started_at: "2026-08-10T10:00:00Z", ended_at: "2026-08-10T10:00:01Z",
    duration_seconds: 1, tasks: { id: "task-1", title: "Focus" },
  }));
  let todayPages = 0;
  const supabase = {
    from(table: string) {
      let limit = Infinity;
      let offset = 0;
      let afterId = "";
      let openOnly = false;
      let today = false;
      const query = {
        select() { return this; },
        is() { openOnly = table === "task_sessions"; return this; },
        not() { return this; },
        lt() { today = true; return this; },
        or() { return this; },
        in() { return this; },
        gt(_column: string, value: string) { afterId = value; return this; },
        order() { return this; },
        limit(value: number) { limit = value; return this; },
        range(from: number, to: number) { offset = from; limit = to - from + 1; return this; },
        then(resolve: (value: unknown) => unknown) {
          if (today) todayPages += 1;
          const rows = table === "tasks" || openOnly ? [] : sessions.filter(row => row.id > afterId);
          return Promise.resolve({ data: rows.slice(offset, offset + limit), error: null }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as NonNullable<Parameters<typeof getTimerWorkspaceData>[0]>["supabase"];
  const result = await getTimerWorkspaceData({ supabase, timezone: "UTC",
    now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(result.todayTotalDurationSeconds, 501);
  assert.equal(result.todayTaskBreakdown[0]?.durationSeconds, 501);
  assert.equal(todayPages, 2);
  // History is deliberately bounded; totals must be independent of that bound.
  assert.equal(result.sessionHistory.length, 50);
});
