import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseTasksRepository } from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");

type Result = { data: unknown; error: { code?: string; message?: string } | null; count?: number | null };
type Step = { method: string; args: unknown[] };

class FakeSupabase {
  queues = new Map<string, Result[]>();
  calls: Array<{ table: string; steps: Step[] }> = [];
  from(table: string) { return new Builder(table, this); }
  push(table: string, result: Result) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }
  pop(table: string): Result {
    return this.queues.get(table)?.shift() ?? { data: null, error: null };
  }
}

class Builder {
  steps: Step[] = [];
  constructor(private table: string, private fake: FakeSupabase) {}
  select(...args: unknown[]) { this.steps.push({ method: "select", args }); return this; }
  eq(...args: unknown[]) { this.steps.push({ method: "eq", args }); return this; }
  in(...args: unknown[]) { this.steps.push({ method: "in", args }); return this; }
  is(...args: unknown[]) { this.steps.push({ method: "is", args }); return this; }
  order(...args: unknown[]) { this.steps.push({ method: "order", args }); return this; }
  insert(...args: unknown[]) { this.steps.push({ method: "insert", args }); return this; }
  upsert(...args: unknown[]) { this.steps.push({ method: "upsert", args }); return this; }
  update(...args: unknown[]) { this.steps.push({ method: "update", args }); return this; }
  delete(...args: unknown[]) { this.steps.push({ method: "delete", args }); return this; }
  maybeSingle(...args: unknown[]) { this.steps.push({ method: "maybeSingle", args }); return this; }
  single(...args: unknown[]) { this.steps.push({ method: "single", args }); return this; }
  then<TResult1, TResult2>(
    fulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.fake.calls.push({ table: this.table, steps: this.steps });
    return Promise.resolve(this.fake.pop(this.table)).then(fulfilled, rejected);
  }
}

function repo(fake: FakeSupabase) {
  return new SupabaseTasksRepository(fake as unknown as SupabaseClient);
}

function taskRow() {
  return {
    id: "task-1", title: "Task", description: null, blocked_reason: null,
    status: "todo", priority: "medium", due_date: null, estimate_minutes: null,
    project_id: "project-1", goal_id: null, planned_for_date: null, focus_rank: null,
    scheduled_start_at: null, scheduled_end_at: null, calendar_sync_enabled: false,
    calendar_reminder_minutes: 10, completed_at: null, archived_at: null,
    created_at: "2026-08-10T00:00:00.000Z", updated_at: "2026-08-10T00:00:00.000Z",
  };
}

function queueTaskHydration(fake: FakeSupabase) {
  fake.push("tasks", { data: taskRow(), error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [], error: null });
}

test("recurrence upsert and clear are explicitly owner scoped", async () => {
  const fake = new FakeSupabase();
  fake.push("task_recurrences", { data: null, error: null });
  queueTaskHydration(fake);
  fake.push("task_recurrences", { data: null, error: null });
  queueTaskHydration(fake);
  const repository = repo(fake);

  assert.equal((await repository.setRecurrence(ACTOR, {
    taskId: "task-1",
    schedule: {
      rule: "daily",
      anchorDate: "2026-08-10",
      timezone: "UTC",
      nextOccurrenceDate: "2026-08-11",
    },
  })).ok, true);
  assert.equal((await repository.setRecurrence(ACTOR, { taskId: "task-1", schedule: null })).ok, true);

  const recurrenceCalls = fake.calls.filter((call) => call.table === "task_recurrences");
  const upsert = recurrenceCalls[0]?.steps.find((step) => step.method === "upsert");
  assert.ok(upsert);
  assert.equal((upsert.args[0] as Record<string, unknown>).owner_user_id, "user-123");
  assert.ok(recurrenceCalls.some((call) => call.steps.some(
    (step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123",
  )));
});

test("Today planned-date and status updates scope task writes to actor ownership", async () => {
  const fake = new FakeSupabase();
  queueTaskHydration(fake);
  queueTaskHydration(fake);
  const repository = repo(fake);

  assert.equal((await repository.setPlannedDate(ACTOR, {
    taskId: "task-1",
    plannedForDate: "2026-08-10",
  })).ok, true);
  assert.equal((await repository.setStatus(ACTOR, {
    taskId: "task-1",
    status: "in_progress",
    blockedReason: null,
  })).ok, true);

  const taskWrites = fake.calls.filter((call) => call.table === "tasks");
  assert.ok(taskWrites.every((call) => call.steps.some(
    (step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123",
  )));
});

test("clear completed Today work is owner and date scoped", async () => {
  const fake = new FakeSupabase();
  fake.push("tasks", { data: null, error: null, count: 2 });

  const result = await repo(fake).clearCompletedPlannedDate(ACTOR, { plannedForDate: "2026-08-10" });

  assert.deepEqual(result, { ok: true, value: 2 });
  const call = fake.calls[0];
  assert.ok(call.steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"));
  assert.ok(call.steps.some((step) => step.method === "eq" && step.args[0] === "planned_for_date" && step.args[1] === "2026-08-10"));
  assert.ok(call.steps.some((step) => step.method === "in" && step.args[0] === "status"));
});
