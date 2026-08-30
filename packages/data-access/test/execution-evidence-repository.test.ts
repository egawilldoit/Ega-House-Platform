import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseExecutionEvidenceRepository } from "../src/execution-evidence/repository";

const ACTOR_A = createAuthenticatedActor("user-a");
const ACTOR_B = createAuthenticatedActor("user-b");

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

// Minimal fake supabase that records query chain and returns queued result.
class FakeExecutionEvidenceSupabase {
  public calls: Array<{ table: string; steps: string[] }> = [];
  private current: { table: string; steps: string[] } | null = null;

  constructor(private readonly results: QueryResult[]) {}

  from(table: string) {
    const entry = { table, steps: [] as string[] };
    this.calls.push(entry);
    this.current = entry;
    return this as unknown as SupabaseClient;
  }

  select(columns: string) {
    this.current?.steps.push(`select:${columns}`);
    return this;
  }
  eq(column: string, value: unknown) {
    this.current?.steps.push(`eq:${column}=${String(value)}`);
    return this;
  }
  lt(column: string, value: unknown) {
    this.current?.steps.push(`lt:${column}=${String(value)}`);
    return this;
  }
  or(value: string) {
    this.current?.steps.push(`or:${value}`);
    return this;
  }
  order(column: string, opts?: { ascending: boolean }) {
    this.current?.steps.push(`order:${column}:${String(opts?.ascending)}`);
    return this;
  }
  limit(n: number) {
    this.current?.steps.push(`limit:${n}`);
    return this;
  }
  then<TResult1, TResult2>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const result = this.results.shift();
    if (!result) throw new Error("No queued result for execution-evidence query");
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

function repo(fake: FakeExecutionEvidenceSupabase) {
  return new SupabaseExecutionEvidenceRepository(fake as unknown as SupabaseClient);
}

test("listSessionsForWindow scopes to actor owner and filters by window", async () => {
  const fake = new FakeExecutionEvidenceSupabase([{ data: [], error: null }]);
  const window = { startIso: "2026-04-20T00:00:00.000Z", endIso: "2026-04-27T00:00:00.000Z" };
  const result = await repo(fake).listSessionsForWindow(ACTOR_A, window);
  assert.equal(result.ok, true);
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((s) => s === "eq:owner_user_id=user-a"), `expected owner filter, got ${steps.join(",")}`);
  assert.ok(steps.some((s) => s.startsWith("lt:started_at=")), "expected lt filter on started_at");
  assert.ok(steps.some((s) => s.startsWith("or:ended_at")), "expected or filter for ended_at");
  assert.ok(steps.includes("order:started_at:true"), `expected deterministic order, got ${steps.join(",")}`);
  assert.ok(steps.includes("order:task_id:true"));
});

test("listSessionsForWindow owner isolation — different actors yield different eq", async () => {
  const window = { startIso: "2026-04-20T00:00:00.000Z", endIso: "2026-04-27T00:00:00.000Z" };
  const fakeA = new FakeExecutionEvidenceSupabase([{ data: [], error: null }]);
  const fakeB = new FakeExecutionEvidenceSupabase([{ data: [], error: null }]);
  await repo(fakeA).listSessionsForWindow(ACTOR_A, window);
  await repo(fakeB).listSessionsForWindow(ACTOR_B, window);
  assert.ok(fakeA.calls[0].steps.includes("eq:owner_user_id=user-a"));
  assert.ok(fakeB.calls[0].steps.includes("eq:owner_user_id=user-b"));
  assert.equal(fakeA.calls[0].steps.includes("eq:owner_user_id=user-b"), false);
});

test("listSessionsForWindow maps rows and preserves task relation for Task/Project/Goal", async () => {
  const fake = new FakeExecutionEvidenceSupabase([
    {
      data: [
        {
          id: "session-1",
          task_id: "task-1",
          started_at: "2026-04-20T09:00:00.000Z",
          ended_at: "2026-04-20T10:00:00.000Z",
          duration_seconds: 3600,
          tasks: { id: "task-1", title: "T", project_id: "p1", goal_id: "g1", projects: { id: "p1", name: "Ops" }, goals: { id: "g1", title: "Goal" } },
        },
      ],
      error: null,
    },
  ]);
  const window = { startIso: "2026-04-20T00:00:00.000Z", endIso: "2026-04-27T00:00:00.000Z" };
  const result = await repo(fake).listSessionsForWindow(ACTOR_A, window);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.length, 1);
  assert.equal(result.value[0].task_id, "task-1");
  assert.equal(result.value[0].tasks?.projects?.name, "Ops");
  assert.equal(result.value[0].tasks?.goals?.title, "Goal");
});

test("listSessionsForWindow returns unknown on persistence error", async () => {
  const fake = new FakeExecutionEvidenceSupabase([{ data: null, error: { message: "boom", code: "PGRST301" } }]);
  const window = { startIso: "2026-04-20T00:00:00.000Z", endIso: "2026-04-27T00:00:00.000Z" };
  const result = await repo(fake).listSessionsForWindow(ACTOR_A, window);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "unknown");
});

test("listSessionsForWindow respects explicit limit and defaults to bounded window", async () => {
  const fake = new FakeExecutionEvidenceSupabase([{ data: [], error: null }]);
  const window = { startIso: "2026-04-20T00:00:00.000Z", endIso: "2026-04-21T00:00:00.000Z" };
  await repo(fake).listSessionsForWindow(ACTOR_A, window, { limit: 500 });
  assert.ok(fake.calls[0].steps.includes("limit:500"));
});

test("repository never reads across windows implicitly — window bounds are present", async () => {
  const fake = new FakeExecutionEvidenceSupabase([{ data: [], error: null }]);
  const window = { startIso: "2026-05-01T00:00:00.000Z", endIso: "2026-05-08T00:00:00.000Z" };
  await repo(fake).listSessionsForWindow(ACTOR_A, window);
  const steps = fake.calls[0].steps.join("|");
  assert.match(steps, /2026-05-01T00:00:00\.000Z/);
  assert.match(steps, /2026-05-08T00:00:00\.000Z/);
});
