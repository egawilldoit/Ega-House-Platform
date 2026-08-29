import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SupabaseWeeklyReviewRepository,
  SupabaseWeeklyReviewTaskRepository,
} from "../src/weekly-review/repository";

const ACTOR = createAuthenticatedActor("user-123");

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count?: number | null;
};

type ChainStep = { method: string; args: unknown[] };

class FakeSupabase {
  calls: Array<{ table: string; steps: ChainStep[] }> = [];
  constructor(private queue: QueryResult[]) {}

  from(table: string) {
    return new FakeBuilder(table, this.queue, this.calls);
  }
}

class FakeBuilder {
  private steps: ChainStep[] = [];
  constructor(
    private readonly table: string,
    private readonly queue: QueryResult[],
    private readonly calls: Array<{ table: string; steps: ChainStep[] }>,
  ) {}

  select(columns: string, options?: unknown) {
    this.steps.push({ method: "select", args: [columns, options] });
    return this;
  }
  eq(column: string, value: unknown) {
    this.steps.push({ method: "eq", args: [column, value] });
    return this;
  }
  neq(column: string, value: unknown) {
    this.steps.push({ method: "neq", args: [column, value] });
    return this;
  }
  lt(column: string, value: unknown) {
    this.steps.push({ method: "lt", args: [column, value] });
    return this;
  }
  gte(column: string, value: unknown) {
    this.steps.push({ method: "gte", args: [column, value] });
    return this;
  }
  is(column: string, value: unknown) {
    this.steps.push({ method: "is", args: [column, value] });
    return this;
  }
  or(expr: string) {
    this.steps.push({ method: "or", args: [expr] });
    return this;
  }
  order(column: string, opts: unknown) {
    this.steps.push({ method: "order", args: [column, opts] });
    return this;
  }
  limit(count: number) {
    this.steps.push({ method: "limit", args: [count] });
    return this;
  }
  maybeSingle() {
    this.steps.push({ method: "maybeSingle", args: [] });
    const result = this.queue.shift() ?? { data: null, error: null };
    this.calls.push({ table: this.table, steps: [...this.steps] });
    return Promise.resolve(result);
  }
  single() {
    this.steps.push({ method: "single", args: [] });
    const result = this.queue.shift() ?? { data: null, error: null };
    this.calls.push({ table: this.table, steps: [...this.steps] });
    return Promise.resolve(result);
  }
  then<TResult1, TResult2>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.calls.push({ table: this.table, steps: [...this.steps] });
    const result = this.queue.shift() ?? { data: null, error: null };
    return Promise.resolve(result as unknown as QueryResult).then(onfulfilled as never, onrejected as never);
  }
}

function weeklyReviewRepo(fake: FakeSupabase) {
  return new SupabaseWeeklyReviewRepository(fake as unknown as SupabaseClient);
}
function weeklyTasksRepo(fake: FakeSupabase) {
  return new SupabaseWeeklyReviewTaskRepository(fake as unknown as SupabaseClient);
}

test("weekly review repo getSavedReview is owner-scoped and week-scoped", async () => {
  const fake = new FakeSupabase([
    {
      data: {
        id: "rev-1",
        week_start: "2026-01-12",
        week_end: "2026-01-18",
        summary: "Great",
        wins: "W",
        blockers: "B",
        next_steps: "N",
        created_at: "2026-01-18T12:00:00.000Z",
        updated_at: null,
        official_email_status: "sent",
        official_email_sent_at: "2026-01-18T13:00:00.000Z",
      },
      error: null,
    },
  ]);
  const result = await weeklyReviewRepo(fake).getSavedReview(ACTOR, "2026-01-12", "2026-01-18");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value?.id, "rev-1");
    assert.equal(result.value?.officialEmailStatus, "sent");
  }
  const steps = fake.calls[0].steps;
  assert.ok(steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
  assert.ok(steps.some((s) => s.method === "eq" && s.args[0] === "week_start"));
  assert.ok(steps.some((s) => s.method === "eq" && s.args[0] === "week_end"));
});

test("listPastReviews respects limit and owner", async () => {
  const fake = new FakeSupabase([{ data: [], error: null }]);
  await weeklyReviewRepo(fake).listPastReviews(ACTOR, 100);
  const steps = fake.calls[0].steps;
  assert.ok(steps.some((s) => s.method === "eq" && s.args[1] === "user-123"));
  assert.ok(steps.some((s) => s.method === "limit" && s.args[0] === 100));
});

test("getPreviousReview uses strict exact W-1 adjacency (eq week_start = W-7)", async () => {
  const fake = new FakeSupabase([{ data: null, error: null }]);
  await weeklyReviewRepo(fake).getPreviousReview(ACTOR, "2026-01-19");
  const steps = fake.calls[0].steps;
  assert.ok(steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
  const eqWeekStart = steps.find((s) => s.method === "eq" && s.args[0] === "week_start");
  assert.ok(eqWeekStart, "should query eq week_start for strict adjacency");
  assert.equal(eqWeekStart!.args[1], "2026-01-12", "previous week is exactly 7 days before");
  assert.ok(!steps.some((s) => s.method === "lt"), "must not use lt newest arbitrary older review");
  assert.ok(!steps.some((s) => s.method === "order"), "strict eq does not need ordering by newest");
});

test("getPreviousReview strict: W-1 missing returns null even if W-2 exists (never newest arbitrary)", async () => {
  // Simulate DB has review for 2026-01-05 (W-2) but not 2026-01-12 (W-1) when querying for 2026-01-19 (W)
  // Repository does eq 2026-01-12, so fake returns null, proving it does not fallback to W-2.
  const fakeMissing = new FakeSupabase([{ data: null, error: null }]);
  const missingResult = await weeklyReviewRepo(fakeMissing).getPreviousReview(ACTOR, "2026-01-19");
  assert.equal(missingResult.ok, true);
  if (missingResult.ok) assert.equal(missingResult.value, null);
  const stepsMissing = fakeMissing.calls[0].steps;
  const queriedStart = stepsMissing.find((s) => s.method === "eq" && s.args[0] === "week_start")?.args[1];
  assert.equal(queriedStart, "2026-01-12");
  // If it were lt, it would have returned the W-2 row; strict ensures null
  const fakeFound = new FakeSupabase([
    {
      data: {
        id: "prev-1",
        week_start: "2026-01-12",
        week_end: "2026-01-18",
        summary: "Prev",
        wins: null,
        blockers: null,
        next_steps: null,
        created_at: "2026-01-18T12:00:00.000Z",
        updated_at: null,
        official_email_status: null,
        official_email_sent_at: null,
      },
      error: null,
    },
  ]);
  const foundResult = await weeklyReviewRepo(fakeFound).getPreviousReview(ACTOR, "2026-01-19");
  assert.equal(foundResult.ok, true);
  if (foundResult.ok) assert.equal(foundResult.value?.id, "prev-1");
});

test("countTasksCreatedForWindow uses head:true count and owner + window bounds", async () => {
  const fake = new FakeSupabase([{ data: null, count: 5, error: null }]);
  const result = await weeklyTasksRepo(fake).countTasksCreatedForWindow(ACTOR, {
    startIso: "2026-01-12T05:00:00.000Z",
    endIso: "2026-01-19T05:00:00.000Z",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 5);
  const steps = fake.calls[0].steps;
  // Should have eq owner_user_id, gte created_at, lt created_at, head:true
  assert.ok(steps.some((s) => s.method === "eq" && s.args[1] === "user-123"));
  assert.ok(steps.some((s) => s.method === "gte" && s.args[0] === "created_at"));
  assert.ok(steps.some((s) => s.method === "lt" && s.args[0] === "created_at"));
  const selectStep = steps.find((s) => s.method === "select");
  const opts = selectStep?.args[1] as Record<string, unknown> | undefined;
  assert.ok(selectStep && opts && (opts as { head?: boolean }).head === true);
});

test("listGoalsTouched uses owner + updated_at window", async () => {
  const fake = new FakeSupabase([{ data: [{ status: "active" }], error: null }]);
  const result = await weeklyTasksRepo(fake).listGoalsTouchedForWindow(ACTOR, {
    startIso: "2026-01-12T05:00:00.000Z",
    endIso: "2026-01-19T05:00:00.000Z",
  });
  assert.equal(result.ok, true);
  const steps = fake.calls[0].steps;
  assert.ok(steps.some((s) => s.method === "gte" && s.args[0] === "updated_at"));
});

test("listBlockedTasks is owner-scoped and limited", async () => {
  const fake = new FakeSupabase([{ data: [{ id: "t1", title: "Blocked", blocked_reason: "Reason", updated_at: "2026-01-15T10:00:00.000Z", status: "blocked" }], error: null }]);
  const result = await weeklyTasksRepo(fake).listBlockedTasks(ACTOR, 6);
  assert.equal(result.ok, true);
  const steps = fake.calls[0].steps;
  assert.ok(steps.some((s) => s.method === "eq" && s.args[1] === "user-123"));
  assert.ok(steps.some((s) => s.method === "limit" && s.args[0] === 6));
});

test("listCompletedTasksForWindow filters to done and window", async () => {
  const fake = new FakeSupabase([
    { data: [{ id: "t1", title: "T", status: "done", blocked_reason: null, estimate_minutes: null, completed_at: "2026-01-13T10:00:00.000Z", updated_at: "2026-01-13T10:00:00.000Z", projects: { name: "Ops" }, goals: null }], error: null },
  ]);
  const result = await weeklyTasksRepo(fake).listCompletedTasksForWindow(ACTOR, { startIso: "2026-01-12T05:00:00.000Z", endIso: "2026-01-19T05:00:00.000Z" }, 80);
  assert.equal(result.ok, true);
  const steps = fake.calls[0].steps;
  assert.ok(steps.some((s) => s.method === "eq" && s.args[0] === "status" && s.args[1] === "done"));
});

test("weekly review repo sanitizes errors", async () => {
  const fake = new FakeSupabase([{ data: null, error: { message: "DB fail" } }]);
  const result = await weeklyReviewRepo(fake).getSavedReview(ACTOR, "2026-01-12", "2026-01-18");
  assert.equal(result.ok, false);
});
