import assert from "node:assert/strict";
import test from "node:test";

import { getTodayPlannerData } from "./today-planner-service";

type SessionRow = {
  id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  owner_user_id: string;
  tasks: { title: string };
};

function createPlannerSupabase(sessions: SessionRow[]) {
  let taskQueryIndex = 0;

  return {
    from(table: string) {
      if (table === "projects" || table === "goals") {
        const scopeChain = {
          select() {
            return scopeChain;
          },
          eq() {
            return scopeChain;
          },
          not() {
            return scopeChain;
          },
          then<TResult>(onFulfilled?: ((value: unknown) => TResult) | null) {
            return Promise.resolve({ data: [], error: null }).then(onFulfilled ?? undefined);
          },
        };
        return scopeChain;
      }

      if (table === "tasks") {
        return {
          select() {
            const chain = {
              eq() {
                return chain;
              },
              neq() {
                return chain;
              },
              not() {
                return chain;
              },
              is() {
                return chain;
              },
              or() {
                return chain;
              },
              order() {
                return chain;
              },
              range() {
                return chain;
              },
              lt() {
                return chain;
              },
              ilike() {
                return chain;
              },
              limit() {
                taskQueryIndex += 1;
                return Promise.resolve({ data: [], error: null });
              },
            };
            return chain;
          },
        };
      }

      assert.equal(table, "task_sessions");
      return {
        select() {
          let isActiveTimerQuery = false;
          let owner: string | null = null;
          let afterId: string | null = null;

          const chain = {
            is(column: string, value: null) {
              assert.equal(column, "ended_at");
              assert.equal(value, null);
              isActiveTimerQuery = true;
              return chain;
            },
            eq(column: string, value: string) {
              if (column === "owner_user_id") owner = value;
              return chain;
            },
            order() {
              return chain;
            },
            limit() {
              return chain;
            },
            gt(column: string, value: string) {
              assert.equal(column, "id");
              afterId = value;
              return chain;
            },
            then<TResult>(
              onFulfilled?: ((value: { data: SessionRow[] | null; error: { message: string } | null }) => TResult) | null,
              onRejected?: ((reason: unknown) => TResult) | null,
            ) {
              if (isActiveTimerQuery) {
                return Promise.resolve<TResult>(
                  { data: [], error: null } as never,
                ).then(onFulfilled as never, onRejected);
              }
              const filtered = sessions.filter(
                (session) =>
                  (owner === null || session.owner_user_id === owner) &&
                  (afterId === null || session.id > afterId),
              );
              return Promise.resolve({ data: filtered, error: null }).then(
                onFulfilled,
                onRejected,
              );
            },
          };
          return chain;
        },
      };
    },
  };
}

test("Today Planner reports a timer summary failure instead of partial totals", async () => {
  const supabase = createPlannerSupabase([]);

  const result = await getTodayPlannerData({
    supabase: supabase as never,
    now: new Date("2026-08-11T09:30:00.000Z"),
    localDate: "2026-08-10",
    timezone: "Pacific/Honolulu",
    ownerUserId: "owner-a",
    timerSummaryResult: {
      data: null,
      errorMessage: "Could not load timer summary right now.",
    },
  } as never);

  assert.equal(result.data, null);
  assert.equal(result.errorMessage, "Could not load Today plan right now.");
});

test("Today Planner summary uses the owner day, not the server-local day", async () => {
  // 2026-08-11T09:30Z = 2026-08-10 23:30 in Pacific/Honolulu.
  // The session is inside the owner's Aug 10 day but is outside a UTC Aug 11 day.
  const sessions: SessionRow[] = [
    {
      id: "0001",
      task_id: "task-1",
      started_at: "2026-08-10T12:00:00.000Z",
      ended_at: "2026-08-10T12:30:00.000Z",
      duration_seconds: 1800,
      owner_user_id: "owner-a",
      tasks: { title: "Focus" },
    },
  ];
  const supabase = createPlannerSupabase(sessions);

  const result = await getTodayPlannerData({
    supabase: supabase as never,
    now: new Date("2026-08-11T09:30:00.000Z"),
    localDate: "2026-08-10",
    timezone: "Pacific/Honolulu",
    ownerUserId: "owner-a",
  } as never);

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.summary.trackedTodaySeconds, 1800);
  assert.equal(result.data?.summary.trackedTodayLabel, "30m 0s");
});
