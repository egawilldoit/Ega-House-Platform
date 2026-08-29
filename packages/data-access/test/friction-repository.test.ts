import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseFrictionRepository } from "../src/friction/repository";

const ACTOR = createAuthenticatedActor("user-123");

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

type ChainStep = { method: string; args: unknown[] };

class FakeSupabase {
  private readonly queues = new Map<string, QueryResult[]>();
  calls: Array<{ table: string; steps: ChainStep[] }> = [];

  from(table: string) {
    return new FakeBuilder(table, this);
  }

  pushResult(table: string, result: QueryResult) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }

  popResult(table: string): QueryResult {
    const queue = this.queues.get(table) ?? [];
    const result = queue.shift();
    return result ?? { data: null, error: null };
  }

  record(table: string, steps: ChainStep[]) {
    this.calls.push({ table, steps });
  }
}

class FakeBuilder {
  private readonly steps: ChainStep[] = [];
  constructor(
    private readonly table: string,
    private readonly supabase: FakeSupabase,
  ) {}

  select(cols: string) {
    this.steps.push({ method: "select", args: [cols] });
    return this;
  }
  eq(col: string, val: unknown) {
    this.steps.push({ method: "eq", args: [col, val] });
    return this;
  }
  order(col: string, opts?: unknown) {
    this.steps.push({ method: "order", args: [col, opts] });
    return this;
  }
  then<TResult1, TResult2>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.supabase.record(this.table, this.steps);
    return Promise.resolve(this.supabase.popResult(this.table)).then(onfulfilled, onrejected);
  }
}

function repo(fake: FakeSupabase) {
  return new SupabaseFrictionRepository(fake as unknown as SupabaseClient);
}

test("listTasks is owner-scoped and maps rows", async () => {
  const fake = new FakeSupabase();
  fake.pushResult("tasks", {
    data: [
      {
        id: "task-1",
        title: "Blocked old",
        blocked_reason: "waiting",
        status: "blocked",
        updated_at: "2026-08-10T00:00:00.000Z",
        project_id: "proj-1",
        goal_id: null,
        archived_at: null,
      },
    ],
    error: null,
  });

  const result = await repo(fake).listTasks(ACTOR);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, [
    {
      id: "task-1",
      title: "Blocked old",
      blockedReason: "waiting",
      status: "blocked",
      updatedAt: "2026-08-10T00:00:00.000Z",
      projectId: "proj-1",
      goalId: null,
      archivedAt: null,
    },
  ]);

  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
  assert.ok(steps.some((s) => s.method === "select" && String(s.args[0]).includes("blocked_reason")));
});

test("listGoals is owner-scoped and maps rows", async () => {
  const fake = new FakeSupabase();
  fake.pushResult("goals", {
    data: [{ id: "goal-1", title: "Stale goal", status: "active", updated_at: "2026-08-10T00:00:00.000Z", project_id: "proj-1" }],
    error: null,
  });

  const result = await repo(fake).listGoals(ACTOR);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, [
    { id: "goal-1", title: "Stale goal", status: "active", updatedAt: "2026-08-10T00:00:00.000Z", projectId: "proj-1" },
  ]);

  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
});

test("listTasks sanitizes persistence errors", async () => {
  const fake = new FakeSupabase();
  fake.pushResult("tasks", { data: null, error: { code: "PGRST500" } });
  const result = await repo(fake).listTasks(ACTOR);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, { code: "unknown" });
});

test("listGoals sanitizes persistence errors", async () => {
  const fake = new FakeSupabase();
  fake.pushResult("goals", { data: null, error: { code: "PGRST500" } });
  const result = await repo(fake).listGoals(ACTOR);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, { code: "unknown" });
});

test("different actors are scoped differently", async () => {
  const fake = new FakeSupabase();
  fake.pushResult("tasks", { data: [], error: null });
  const otherActor = createAuthenticatedActor("user-999");
  await repo(fake).listTasks(otherActor);
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((s) => s.method === "eq" && s.args[1] === "user-999"));
  assert.ok(!steps.some((s) => s.args[1] === "user-123"));
});
