import assert from "node:assert/strict";
import test from "node:test";

import {
  getStartupPlannerData,
  planStartupTasksForToday,
} from "./startup-planner-service";

type MockTask = {
  id: string;
  title: string;
  blocked_reason: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  planned_for_date: string | null;
  focus_rank: number | null;
  updated_at: string;
  goal_id: string | null;
  projects: { name: string; slug: string } | null;
  goals: { title: string } | null;
};

type MockGoal = {
  id: string;
  title: string;
  status: string;
  health: string | null;
  next_step: string | null;
  updated_at: string;
  projects: { name: string; slug: string } | null;
};

type MockReview = {
  id: string;
  week_start: string;
  week_end: string;
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  next_steps: string | null;
  updated_at: string;
};

function createStartupSupabaseMock(input?: {
  tasks?: MockTask[];
  goals?: MockGoal[];
  reviews?: MockReview[];
}) {
  const tasks = [...(input?.tasks ?? [])];
  const goals = [...(input?.goals ?? [])];
  const reviews = [...(input?.reviews ?? [])];

  type Filter = {
    op: "eq" | "neq" | "not" | "gte" | "lte" | "is";
    column: string;
    value: unknown;
    comparator?: string;
  };

  class QueryChain<T extends Record<string, unknown>> {
    private filters: Filter[] = [];
    private orderBy: Array<{ column: string; ascending: boolean }> = [];

    constructor(
      private readonly rows: T[],
      private readonly transform: (row: T, columns: string) => Record<string, unknown>,
      private readonly columns: string,
    ) {}

    eq(column: string, value: unknown) {
      this.filters.push({ op: "eq", column, value });
      return this;
    }

    neq(column: string, value: unknown) {
      this.filters.push({ op: "neq", column, value });
      return this;
    }

    not(column: string, comparator: string, value: unknown) {
      this.filters.push({ op: "not", column, comparator, value });
      return this;
    }

    is(column: string, value: null) {
      this.filters.push({ op: "is", column, value });
      return this;
    }

    gte(column: string, value: unknown) {
      this.filters.push({ op: "gte", column, value });
      return this;
    }

    lte(column: string, value: unknown) {
      this.filters.push({ op: "lte", column, value });
      return this;
    }

    order(column: string, options?: { ascending?: boolean }) {
      this.orderBy.push({ column, ascending: options?.ascending ?? true });
      return this;
    }

    limit(value: number) {
      const rows = this.apply().slice(0, value);
      return Promise.resolve({ data: rows, error: null });
    }

    maybeSingle() {
      const rows = this.apply();
      return Promise.resolve({
        data: rows[0] ?? null,
        error: null,
      });
    }

    then<TResult1 = Awaited<{ data: Record<string, unknown>[]; error: null }>, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: Record<string, unknown>[]; error: null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve({ data: this.apply(), error: null }).then(onfulfilled, onrejected);
    }

    private apply() {
      let rows = [...this.rows];

      for (const filter of this.filters) {
        rows = rows.filter((row) => {
          const field = row[filter.column as keyof T];

          if (filter.op === "eq") {
            return field === filter.value;
          }
          if (filter.op === "neq") {
            return field !== filter.value;
          }
          if (filter.op === "not" && filter.comparator === "is") {
            return field !== filter.value;
          }
          if (filter.op === "is") {
            return (field ?? null) === filter.value;
          }
          if (filter.op === "gte") {
            return String(field ?? "") >= String(filter.value ?? "");
          }
          if (filter.op === "lte") {
            return String(field ?? "") <= String(filter.value ?? "");
          }
          return true;
        });
      }

      for (let index = this.orderBy.length - 1; index >= 0; index -= 1) {
        const order = this.orderBy[index];
        rows.sort((left, right) => {
          const leftValue = String(left[order.column as keyof T] ?? "");
          const rightValue = String(right[order.column as keyof T] ?? "");
          const compare = leftValue.localeCompare(rightValue);
          return order.ascending ? compare : -compare;
        });
      }

      return rows.map((row) => this.transform(row, this.columns));
    }
  }

  function toSelectedTask(task: MockTask, columns: string) {
    if (columns === "goal_id") {
      return { goal_id: task.goal_id };
    }
    if (columns === "id, status") {
      return { id: task.id, status: task.status };
    }
    return {
      id: task.id,
      title: task.title,
      blocked_reason: task.blocked_reason,
      status: task.status,
      priority: task.priority,
      due_date: task.due_date,
      planned_for_date: task.planned_for_date,
      focus_rank: task.focus_rank,
      updated_at: task.updated_at,
      projects: task.projects,
      goals: task.goals,
    };
  }

  return {
    from(table: string) {
      if (table === "tasks") {
        return {
          select(columns: string) {
            return new QueryChain(tasks, toSelectedTask, columns);
          },
        };
      }

      if (table === "goals") {
        return {
          select(columns: string) {
            return new QueryChain(
              goals,
              (goal) => ({
                id: goal.id,
                title: goal.title,
                status: goal.status,
                health: goal.health,
                next_step: goal.next_step,
                updated_at: goal.updated_at,
                projects: goal.projects,
              }),
              columns,
            );
          },
        };
      }

      if (table === "week_reviews") {
        return {
          select(columns: string) {
            return new QueryChain(
              reviews,
              (review) => ({
                id: review.id,
                week_start: review.week_start,
                week_end: review.week_end,
                summary: review.summary,
                wins: review.wins,
                blockers: review.blockers,
                next_steps: review.next_steps,
                updated_at: review.updated_at,
              }),
              columns,
            );
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("loads startup planning data when no prior review exists", async () => {
  const result = await getStartupPlannerData({
    now: new Date("2026-04-20T08:00:00.000Z"),
    supabase: createStartupSupabaseMock({
      tasks: [],
      goals: [],
      reviews: [],
    }) as never,
  });

  assert.equal(result.errorMessage, null);
  assert.ok(result.data);
  assert.equal(result.data?.review.latest, null);
  assert.equal(result.data?.blockersCarryForward.length, 0);
  assert.equal(result.data?.keyGoals.length, 0);
  assert.equal(result.data?.focusTasks.length, 0);
  assert.equal(result.data?.dueSoonTasks.length, 0);
});

test("loads startup planning with existing weekly review and section data", async () => {
  const result = await getStartupPlannerData({
    now: new Date("2026-04-20T08:00:00.000Z"),
    supabase: createStartupSupabaseMock({
      tasks: [
        {
          id: "blocked-1",
          title: "Blocked task",
          blocked_reason: "Needs approval",
          status: "blocked",
          priority: "high",
          due_date: "2026-04-23",
          planned_for_date: null,
          focus_rank: null,
          updated_at: "2026-04-20T07:00:00.000Z",
          goal_id: "goal-1",
          projects: { name: "Ops", slug: "ops" },
          goals: { title: "Reduce toil" },
        },
        {
          id: "focus-1",
          title: "Pinned task",
          blocked_reason: null,
          status: "todo",
          priority: "medium",
          due_date: "2026-04-21",
          planned_for_date: null,
          focus_rank: 1,
          updated_at: "2026-04-20T07:30:00.000Z",
          goal_id: "goal-1",
          projects: { name: "Ops", slug: "ops" },
          goals: { title: "Reduce toil" },
        },
      ],
      goals: [
        {
          id: "goal-1",
          title: "Reduce toil",
          status: "active",
          health: "on_track",
          next_step: "Ship startup checklist",
          updated_at: "2026-04-20T06:00:00.000Z",
          projects: { name: "Ops", slug: "ops" },
        },
      ],
      reviews: [
        {
          id: "review-1",
          week_start: "2026-04-20",
          week_end: "2026-04-26",
          summary: "Strong prior week output.",
          wins: null,
          blockers: null,
          next_steps: null,
          updated_at: "2026-04-20T05:00:00.000Z",
        },
      ],
    }) as never,
  });

  assert.equal(result.errorMessage, null);
  assert.ok(result.data);
  assert.equal(result.data?.review.currentWeek?.id, "review-1");
  assert.equal(result.data?.blockersCarryForward[0]?.id, "blocked-1");
  assert.equal(result.data?.focusTasks[0]?.id, "focus-1");
  assert.equal(result.data?.keyGoals[0]?.linkedOpenTaskCount, 2);
});

function createScopedPlanningSupabaseMock() {
  const updates: Array<{ taskId: string; planned_for_date: string | null }> = [];
  const ownedTaskIds = new Set(["owned-task"]);

  return {
    updates,
    supabase: {
      from(table: string) {
        if (table !== "tasks") {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          select(columns: string) {
            assert.equal(columns, "id");
            return {
              eq(column: string, value: string) {
                assert.equal(column, "id");
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: ownedTaskIds.has(value) ? { id: value } : null,
                      error: null,
                    });
                  },
                };
              },
            };
          },
          update(payload: { planned_for_date: string | null }) {
            return {
              eq(column: string, value: string) {
                assert.equal(column, "id");
                return {
                  select(selectColumns: string) {
                    assert.equal(selectColumns, "id");
                    return {
                      maybeSingle() {
                        updates.push({ taskId: value, planned_for_date: payload.planned_for_date });
                        return Promise.resolve({ data: { id: value }, error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as never,
  };
}

test("planning actions keep user scope and stop when task is unavailable", async () => {
  const mock = createScopedPlanningSupabaseMock();
  const result = await planStartupTasksForToday(["owned-task", "foreign-task"], {
    supabase: mock.supabase,
    now: new Date("2026-04-20T08:00:00.000Z"),
  });

  assert.equal(result.errorMessage, "Task is unavailable.");
  assert.equal(result.addedCount, 1);
  assert.equal(mock.updates.length, 1);
  assert.equal(mock.updates[0]?.taskId, "owned-task");
});
