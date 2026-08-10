import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseTasksRepository } from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");

type Result = { data: unknown; error: { code?: string; message?: string } | null };
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
  neq(...args: unknown[]) { this.steps.push({ method: "neq", args }); return this; }
  in(...args: unknown[]) { this.steps.push({ method: "in", args }); return this; }
  is(...args: unknown[]) { this.steps.push({ method: "is", args }); return this; }
  order(...args: unknown[]) { this.steps.push({ method: "order", args }); return this; }
  limit(...args: unknown[]) { this.steps.push({ method: "limit", args }); return this; }
  insert(...args: unknown[]) { this.steps.push({ method: "insert", args }); return this; }
  update(...args: unknown[]) { this.steps.push({ method: "update", args }); return this; }
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

function repository(fake: FakeSupabase) {
  return new SupabaseTasksRepository(fake as unknown as SupabaseClient);
}

function taskRow() {
  return {
    id: "task-1",
    title: "Task",
    description: null,
    blocked_reason: null,
    status: "todo",
    priority: "medium",
    due_date: null,
    estimate_minutes: null,
    project_id: "project-1",
    goal_id: null,
    planned_for_date: null,
    focus_rank: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    completed_at: null,
    archived_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
  };
}

test("task list is owner scoped and hydrates reminders and recurrence without privileged access", async () => {
  const fake = new FakeSupabase();
  fake.push("tasks", { data: [taskRow()], error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [], error: null });

  const result = await repository(fake).listTasks(ACTOR, { includeArchived: false });

  assert.equal(result.ok, true);
  assert.equal(fake.calls[0]?.table, "tasks");
  assert.ok(fake.calls[0]?.steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"));
  assert.ok(fake.calls[1]?.steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"));
  assert.ok(fake.calls[2]?.steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"));
});

test("task create sets owner_user_id and returns the inserted task", async () => {
  const fake = new FakeSupabase();
  fake.push("tasks", { data: taskRow(), error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [], error: null });

  const result = await repository(fake).createTask(ACTOR, {
    title: "Task",
    projectId: "project-1",
    goalId: null,
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
  });

  assert.equal(result.ok, true);
  const insert = fake.calls[0]?.steps.find((step) => step.method === "insert");
  assert.ok(insert);
  assert.equal((insert.args[0] as Record<string, unknown>).owner_user_id, "user-123");
});

test("scope reads projects and goals with explicit actor ownership", async () => {
  const fake = new FakeSupabase();
  fake.push("projects", { data: [{ id: "project-1" }], error: null });
  fake.push("goals", { data: [{ id: "goal-1", project_id: "project-1" }], error: null });

  const result = await repository(fake).getScope(ACTOR);

  assert.equal(result.ok, true);
  assert.ok(fake.calls.every((call) => call.steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123")));
});

test("reminder create and cancel are owner scoped", async () => {
  const fake = new FakeSupabase();
  fake.push("task_reminders", { data: null, error: null });
  fake.push("tasks", { data: taskRow(), error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [], error: null });
  fake.push("task_reminders", { data: null, error: null });
  fake.push("tasks", { data: taskRow(), error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [], error: null });

  const repo = repository(fake);
  assert.equal((await repo.createReminder(ACTOR, {
    taskId: "task-1",
    remindAt: "2026-08-11T00:00:00.000Z",
    channel: "email",
    status: "pending",
  })).ok, true);
  assert.equal((await repo.cancelReminder(ACTOR, {
    taskId: "task-1",
    reminderId: "reminder-1",
    status: "cancelled",
  })).ok, true);

  const reminderCalls = fake.calls.filter((call) => call.table === "task_reminders");
  assert.ok(reminderCalls[0]?.steps.some((step) => step.method === "insert" && (step.args[0] as Record<string, unknown>).owner_user_id === "user-123"));
  assert.ok(reminderCalls.some((call) => call.steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123")));
});
