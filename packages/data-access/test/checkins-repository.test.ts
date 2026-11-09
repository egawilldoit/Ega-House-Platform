import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseDailyCheckinRepository } from "../src/checkins/repository";

const ACTOR = createAuthenticatedActor("owner-checkins");

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

const ROW = {
  local_date: "2026-02-16",
  timezone: "Africa/Casablanca",
  outcomes: "Shipped the planner",
  personal_minutes: 45,
  notes: null,
  overtime_minutes: 30,
  overtime_reason: "Release window",
  created_at: "2026-02-16T20:00:00.000Z",
  updated_at: "2026-02-16T20:00:00.000Z",
};

class FakeBuilder implements PromiseLike<QueryResult> {
  private readonly steps: string[] = [];

  constructor(
    private readonly queue: QueryResult[],
    private readonly calls: Array<{ table: string; steps: string[] }>,
    private readonly table: string,
  ) {}

  private record(step: string) {
    this.steps.push(step);
    return this;
  }

  select(columns: string) {
    return this.record(`select:${columns}`);
  }
  eq(column: string, value: unknown) {
    return this.record(`eq:${column}=${String(value)}`);
  }
  gte(column: string, value: unknown) {
    return this.record(`gte:${column}=${String(value)}`);
  }
  lte(column: string, value: unknown) {
    return this.record(`lte:${column}=${String(value)}`);
  }
  order(column: string, options: { ascending: boolean }) {
    return this.record(`order:${column}:${options.ascending}`);
  }
  upsert(payload: unknown, options: { onConflict: string }) {
    return this.record(`upsert:${JSON.stringify(payload)}:onConflict=${options.onConflict}`);
  }

  private settle(label: string): QueryResult {
    this.steps.push(label);
    const result = this.queue.shift() ?? { data: null, error: null };
    this.calls.push({ table: this.table, steps: [...this.steps] });
    return result;
  }

  maybeSingle() {
    return Promise.resolve(this.settle("maybeSingle"));
  }
  single() {
    return Promise.resolve(this.settle("single"));
  }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.settle("await")).then(onfulfilled, onrejected);
  }
}

class FakeSupabase {
  calls: Array<{ table: string; steps: string[] }> = [];
  constructor(private readonly queue: QueryResult[]) {}

  from(table: string) {
    return new FakeBuilder(this.queue, this.calls, table);
  }
}

function repo(fake: FakeSupabase) {
  return new SupabaseDailyCheckinRepository(fake as unknown as SupabaseClient);
}

test("get maps the row and scopes by the verified owner", async () => {
  const fake = new FakeSupabase([{ data: ROW, error: null }]);
  const result = await repo(fake).get(ACTOR, "2026-02-16");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value?.localDate, "2026-02-16");
  assert.equal(result.value?.personalMinutes, 45);
  assert.equal(result.value?.overtimeReason, "Release window");
  assert.equal(fake.calls[0]?.table, "daily_checkins");
  assert.ok(fake.calls[0]?.steps.includes("eq:owner_user_id=owner-checkins"));
  assert.ok(fake.calls[0]?.steps.includes("eq:local_date=2026-02-16"));
});

test("get returns null when the owner has no record", async () => {
  const fake = new FakeSupabase([{ data: null, error: null }]);
  const result = await repo(fake).get(ACTOR, "2026-02-16");
  assert.deepEqual(result, { ok: true, value: null });
});

test("save upserts by owner/date and returns the stored record", async () => {
  const fake = new FakeSupabase([{ data: ROW, error: null }]);
  const result = await repo(fake).save(ACTOR, {
    localDate: "2026-02-16",
    timezone: "Africa/Casablanca",
    outcomes: "Shipped the planner",
    personalMinutes: 45,
    notes: null,
    overtimeMinutes: 30,
    overtimeReason: "Release window",
    routine: null,
    createdAt: ROW.created_at,
    updatedAt: ROW.updated_at,
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.localDate, "2026-02-16");
  const step = fake.calls[0]?.steps.find((entry) => entry.startsWith("upsert:"));
  assert.ok(step?.includes('"owner_user_id":"owner-checkins"'));
  assert.ok(step?.includes('"local_date":"2026-02-16"'));
  assert.ok(step?.includes("onConflict=owner_user_id,local_date"));
});

test("save failure is a failure, never success-shaped", async () => {
  const fake = new FakeSupabase([{ data: null, error: { code: "42501", message: "denied" } }]);
  const result = await repo(fake).save(ACTOR, {
    localDate: "2026-02-16",
    timezone: "Africa/Casablanca",
    outcomes: null,
    personalMinutes: null,
    notes: null,
    overtimeMinutes: null,
    overtimeReason: null,
    routine: null,
    createdAt: ROW.created_at,
    updatedAt: ROW.updated_at,
  });
  assert.equal(result.ok, false);
});

test("listBetween bounds the range and returns ascending rows", async () => {
  const fake = new FakeSupabase([{ data: [ROW], error: null }]);
  const result = await repo(fake).listBetween(ACTOR, "2026-02-16", "2026-02-22");

  assert.equal(result.ok, true);
  assert.ok(fake.calls[0]?.steps.includes("gte:local_date=2026-02-16"));
  assert.ok(fake.calls[0]?.steps.includes("lte:local_date=2026-02-22"));
  assert.ok(fake.calls[0]?.steps.includes("order:local_date:true"));
});

test("get maps routine metrics and retries without the column before 0092 is applied", async () => {
  const withRoutine = new FakeSupabase([{ data: { ...ROW, routine: { runMinutes: 30, runCompleted: true, sleepHours: 7.5 } }, error: null }]);
  const loaded = await repo(withRoutine).get(ACTOR, "2026-02-16");
  assert.equal(loaded.ok, true);
  if (!loaded.ok || !loaded.value) return;
  assert.deepEqual(loaded.value.routine, {
    runMinutes: 30, runCompleted: true, runSkipped: null,
    chessMinutes: null, sleepHours: 7.5, leisureMinutes: null,
  });

  const legacy = new FakeSupabase([
    { data: null, error: { code: "42703", message: 'column "routine" does not exist' } },
    { data: ROW, error: null },
  ]);
  const fallen = await repo(legacy).get(ACTOR, "2026-02-16");
  assert.equal(fallen.ok, true);
  if (!fallen.ok || !fallen.value) return;
  assert.equal(fallen.value.routine, null);
  assert.equal(legacy.calls.length, 2);
});

test("save writes routine metrics only when present", async () => {
  const fake = new FakeSupabase([{ data: ROW, error: null }]);
  const result = await repo(fake).save(ACTOR, {
    localDate: "2026-02-16",
    timezone: "Africa/Casablanca",
    outcomes: null,
    personalMinutes: null,
    notes: null,
    overtimeMinutes: null,
    overtimeReason: null,
    routine: { runMinutes: 30, runCompleted: true, runSkipped: null, chessMinutes: null, sleepHours: null, leisureMinutes: null },
    createdAt: ROW.created_at,
    updatedAt: ROW.updated_at,
  });
  assert.equal(result.ok, true);
  const step = fake.calls[0]?.steps.find((entry) => entry.startsWith("upsert:"));
  assert.ok(step?.includes('"routine":{"runMinutes":30'));
});
