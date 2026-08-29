import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SupabaseGoalsRepository,
  SupabaseProjectsRepository,
  SupabaseTasksRepository,
  SupabaseTimerSessionRepository,
} from "../src/index";

const ACTOR = createAuthenticatedActor("owner-a");
const OPERATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const CLIENT_ID = "mcp-client-a";

type FakeError = {
  code?: string;
  constraint?: string;
  details?: string;
  hint?: string;
  message?: string;
};

type FakeResult = { data: unknown; error: FakeError | null };
type FakeStep = { method: string; args: unknown[] };
type FakeCall = { table: string; steps: FakeStep[] };

class FakeSupabase {
  private readonly queues = new Map<string, FakeResult[]>();
  readonly calls: FakeCall[] = [];
  readonly successfulInsertCounts = new Map<string, number>();

  push(table: string, result: FakeResult) {
    this.queues.set(table, [...(this.queues.get(table) ?? []), result]);
  }

  from(table: string) {
    return new FakeQueryBuilder(this, table);
  }

  take(table: string): FakeResult {
    const queue = this.queues.get(table);
    return queue?.shift() ?? { data: [], error: null };
  }

  record(table: string, steps: FakeStep[], result: FakeResult) {
    this.calls.push({ table, steps: [...steps] });
    if (steps.some((step) => step.method === "insert") && !result.error) {
      this.successfulInsertCounts.set(
        table,
        (this.successfulInsertCounts.get(table) ?? 0) + 1,
      );
    }
  }
}

class FakeQueryBuilder {
  private readonly steps: FakeStep[] = [];

  constructor(
    private readonly fake: FakeSupabase,
    private readonly table: string,
  ) {}

  select(...args: unknown[]) {
    this.steps.push({ method: "select", args });
    return this;
  }

  eq(...args: unknown[]) {
    this.steps.push({ method: "eq", args });
    return this;
  }

  in(...args: unknown[]) {
    this.steps.push({ method: "in", args });
    return this;
  }

  is(...args: unknown[]) {
    this.steps.push({ method: "is", args });
    return this;
  }

  order(...args: unknown[]) {
    this.steps.push({ method: "order", args });
    return this;
  }

  insert(...args: unknown[]) {
    this.steps.push({ method: "insert", args });
    return this;
  }

  single() {
    this.steps.push({ method: "single", args: [] });
    return this;
  }

  maybeSingle() {
    this.steps.push({ method: "maybeSingle", args: [] });
    return this;
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const result = this.fake.take(this.table);
    this.fake.record(this.table, this.steps, result);
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

type StoredRow = Record<string, unknown>;

class ConcurrentFakeSupabase {
  private readonly rows = new Map<string, StoredRow[]>();
  readonly calls: FakeCall[] = [];
  readonly successfulInsertCounts = new Map<string, number>();

  seed(table: string, row: StoredRow) {
    this.rows.set(table, [...(this.rows.get(table) ?? []), row]);
  }

  count(table: string) {
    return this.rows.get(table)?.length ?? 0;
  }

  from(table: string) {
    return new ConcurrentFakeQueryBuilder(this, table);
  }

  execute(table: string, steps: FakeStep[]): FakeResult {
    const insert = steps.find((step) => step.method === "insert");
    if (insert) {
      const payload = insert.args[0] as StoredRow;
      const tableRows = this.rows.get(table) ?? [];
      const operationCollision =
        typeof payload.mcp_operation_id === "string" &&
        typeof payload.mcp_client_id === "string" &&
        tableRows.some(
          (row) =>
            row.owner_user_id === payload.owner_user_id &&
            row.mcp_client_id === payload.mcp_client_id &&
            row.mcp_operation_id === payload.mcp_operation_id,
        );
      if (operationCollision) {
        const indexName = `${table}_mcp_operation_unique`;
        return this.record(table, steps, { data: null, error: uniqueError(indexName) });
      }

      if (
        table === "task_sessions" &&
        tableRows.some(
          (row) => row.owner_user_id === payload.owner_user_id && row.ended_at === null,
        )
      ) {
        return this.record(table, steps, {
          data: null,
          error: uniqueError("task_sessions_owner_open_unique"),
        });
      }

      const row = storedRow(table, payload, tableRows.length + 1);
      this.rows.set(table, [...tableRows, row]);
      this.successfulInsertCounts.set(
        table,
        (this.successfulInsertCounts.get(table) ?? 0) + 1,
      );
      const data = steps.some((step) => step.method === "select") ? row : null;
      return this.record(table, steps, { data, error: null });
    }

    let selected = [...(this.rows.get(table) ?? [])];
    for (const step of steps) {
      if (step.method === "eq") {
        selected = selected.filter((row) => row[step.args[0] as string] === step.args[1]);
      } else if (step.method === "is" && step.args[1] === null) {
        selected = selected.filter(
          (row) => row[step.args[0] as string] === null || row[step.args[0] as string] === undefined,
        );
      } else if (step.method === "in") {
        const values = step.args[1] as unknown[];
        selected = selected.filter((row) => values.includes(row[step.args[0] as string]));
      } else if (step.method === "limit") {
        selected = selected.slice(0, Number(step.args[0]));
      }
    }

    const data = steps.some((step) => step.method === "maybeSingle" || step.method === "single")
      ? selected[0] ?? null
      : selected;
    return this.record(table, steps, { data, error: null });
  }

  private record(table: string, steps: FakeStep[], result: FakeResult): FakeResult {
    this.calls.push({ table, steps: [...steps] });
    return result;
  }
}

class ConcurrentFakeQueryBuilder {
  private readonly steps: FakeStep[] = [];

  constructor(
    private readonly fake: ConcurrentFakeSupabase,
    private readonly table: string,
  ) {}

  select(...args: unknown[]) {
    this.steps.push({ method: "select", args });
    return this;
  }

  eq(...args: unknown[]) {
    this.steps.push({ method: "eq", args });
    return this;
  }

  in(...args: unknown[]) {
    this.steps.push({ method: "in", args });
    return this;
  }

  is(...args: unknown[]) {
    this.steps.push({ method: "is", args });
    return this;
  }

  order(...args: unknown[]) {
    this.steps.push({ method: "order", args });
    return this;
  }

  limit(...args: unknown[]) {
    this.steps.push({ method: "limit", args });
    return this;
  }

  insert(...args: unknown[]) {
    this.steps.push({ method: "insert", args });
    return this;
  }

  single() {
    this.steps.push({ method: "single", args: [] });
    return this;
  }

  maybeSingle() {
    this.steps.push({ method: "maybeSingle", args: [] });
    return this;
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const result = this.fake.execute(this.table, this.steps);
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

function storedRow(table: string, payload: StoredRow, ordinal: number): StoredRow {
  const timestamps = {
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
  if (table === "projects") {
    return { ...payload, id: `project-${ordinal}`, status: "active", ...timestamps };
  }
  if (table === "goals") {
    return { ...payload, id: `goal-${ordinal}`, ...timestamps };
  }
  if (table === "tasks") {
    return {
      ...payload,
      id: `task-${ordinal}`,
      blocked_reason: payload.blocked_reason ?? null,
      due_date: payload.due_date ?? null,
      estimate_minutes: payload.estimate_minutes ?? null,
      planned_for_date: payload.planned_for_date ?? null,
      focus_rank: null,
      archived_at: null,
      scheduled_start_at: null,
      scheduled_end_at: null,
      calendar_sync_enabled: false,
      calendar_reminder_minutes: 10,
      completed_at: null,
      projects: null,
      goals: null,
      ...timestamps,
    };
  }
  if (table === "task_reminders") {
    return {
      ...payload,
      id: `reminder-${ordinal}`,
      sent_at: null,
      failure_reason: null,
      ...timestamps,
    };
  }
  return {
    ...payload,
    id: `session-${ordinal}`,
    ended_at: null,
    duration_seconds: null,
    tasks: { title: "Concurrent task" },
    ...timestamps,
  };
}

function asSupabase(fake: object): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

function hasFilter(call: FakeCall, column: string, value: string): boolean {
  return call.steps.some(
    (step) => step.method === "eq" && step.args[0] === column && step.args[1] === value,
  );
}

function assertExactOperationLookup(fake: { calls: FakeCall[] }, table: string) {
  const lookup = fake.calls.find(
    (call) =>
      call.table === table &&
      call.steps.some((step) => step.method === "maybeSingle") &&
      hasFilter(call, "mcp_operation_id", OPERATION_ID),
  );
  assert.ok(lookup, `${table} replay must use an exact operation lookup`);
  assert.equal(hasFilter(lookup, "owner_user_id", ACTOR.userId), true);
  assert.equal(hasFilter(lookup, "mcp_client_id", CLIENT_ID), true);
}

function goalRow() {
  return {
    id: "goal-a",
    project_id: "project-a",
    title: "Finish the kitchen",
    slug: "finish-the-kitchen",
    description: "Cabinets",
    next_step: "Order the countertop",
    health: "on_track",
    status: "active",
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
}

function taskRow() {
  return {
    id: "task-a",
    title: "Measure the wall",
    description: null,
    blocked_reason: null,
    status: "todo",
    priority: "medium",
    due_date: null,
    estimate_minutes: 30,
    project_id: "project-a",
    goal_id: null,
    planned_for_date: null,
    focus_rank: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    completed_at: null,
    archived_at: null,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
}

function sessionRow() {
  return {
    id: "session-a",
    task_id: "task-a",
    started_at: "2026-08-28T10:00:00.000Z",
    ended_at: null,
    duration_seconds: null,
    tasks: { title: "Measure the wall" },
  };
}

function reminderRow() {
  return {
    id: "reminder-a",
    task_id: "task-a",
    remind_at: "2026-08-29T10:00:00.000Z",
    channel: "email",
    status: "pending",
    sent_at: null,
    failure_reason: null,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
}

function uniqueError(indexName: string): FakeError {
  return {
    code: "23505",
    constraint: indexName,
    message: `duplicate key value violates unique constraint "${indexName}"`,
  };
}

test("project crash after effect: lease-expiry retry reads the one canonical project", async () => {
  const fake = new FakeSupabase();
  const repository = new SupabaseProjectsRepository(asSupabase(fake));
  const input = {
    name: "Kitchen",
    slug: "kitchen",
    description: null,
    mcpOperationId: OPERATION_ID,
    mcpClientId: CLIENT_ID,
  };

  fake.push("projects", { data: null, error: null });
  const first = await repository.createProject(ACTOR, input);
  assert.equal(first.ok, true);

  // The domain INSERT committed, then the process crashed before receipt.store.
  // A fresh claim after lease expiry attempts the same fenced INSERT.
  // PostgreSQL can report the owner+slug index first for identical project
  // retries. The repository must verify the exact operation identity before
  // treating that collision as a replay.
  fake.push("projects", {
    data: null,
    error: uniqueError("projects_owner_user_id_slug_unique"),
  });
  fake.push("projects", { data: { id: "project-a" }, error: null });
  const retry = await repository.createProject(ACTOR, input);
  assert.equal(retry.ok, true);

  fake.push("projects", {
    data: {
      id: "project-a",
      name: "Kitchen",
      slug: "kitchen",
      description: null,
      status: "active",
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    },
    error: null,
  });
  const canonical = await repository.getProjectBySlug(ACTOR, "kitchen");

  assert.equal(canonical.ok, true);
  if (canonical.ok) assert.equal(canonical.value?.id, "project-a");
  assert.equal(fake.successfulInsertCounts.get("projects"), 1);
});

test("project slug collisions without the exact operation remain failures", async () => {
  const fake = new FakeSupabase();
  const repository = new SupabaseProjectsRepository(asSupabase(fake));

  fake.push("projects", {
    data: null,
    error: uniqueError("projects_owner_user_id_slug_unique"),
  });
  fake.push("projects", { data: null, error: null });

  const result = await repository.createProject(ACTOR, {
    name: "Different kitchen",
    slug: "kitchen",
    description: null,
    mcpOperationId: OPERATION_ID,
    mcpClientId: CLIENT_ID,
  });

  assert.equal(result.ok, false);
  assertExactOperationLookup(fake, "projects");
  assert.equal(fake.successfulInsertCounts.get("projects") ?? 0, 0);
});

test("goal crash after effect: lease-expiry retry returns the original goal", async () => {
  const fake = new FakeSupabase();
  const repository = new SupabaseGoalsRepository(asSupabase(fake));
  const input = {
    title: "Finish the kitchen",
    projectId: "project-a",
    description: "Cabinets",
    nextStep: "Order the countertop",
    health: "on_track" as const,
    status: "active" as const,
    slug: "finish-the-kitchen",
    mcpOperationId: OPERATION_ID,
    mcpClientId: CLIENT_ID,
  };

  fake.push("goals", { data: goalRow(), error: null });
  const first = await repository.createGoal(ACTOR, input);
  assert.equal(first.ok, true);

  // Receipt completion is intentionally omitted before the retry.
  fake.push("goals", { data: null, error: uniqueError("goals_mcp_operation_unique") });
  fake.push("goals", { data: goalRow(), error: null });
  const retry = await repository.createGoal(ACTOR, input);

  assert.equal(first.ok && retry.ok, true);
  if (first.ok && retry.ok) assert.equal(retry.value?.id, first.value?.id);
  assert.equal(fake.successfulInsertCounts.get("goals"), 1);
  assertExactOperationLookup(fake, "goals");
});

test("task crash after effect: lease-expiry retry returns the original task", async () => {
  const fake = new FakeSupabase();
  const repository = new SupabaseTasksRepository(asSupabase(fake));
  const input = {
    title: "Measure the wall",
    projectId: "project-a",
    goalId: null,
    description: null,
    blockedReason: null,
    status: "todo" as const,
    priority: "medium" as const,
    dueDate: null,
    estimateMinutes: 30,
    mcpOperationId: OPERATION_ID,
    mcpClientId: CLIENT_ID,
  };

  fake.push("tasks", { data: taskRow(), error: null });
  const first = await repository.createTask(ACTOR, input);
  assert.equal(first.ok, true);

  // The task row exists, but the receipt did not commit before the worker died.
  fake.push("tasks", { data: null, error: uniqueError("tasks_mcp_operation_unique") });
  fake.push("tasks", { data: taskRow(), error: null });
  const retry = await repository.createTask(ACTOR, input);

  assert.equal(first.ok && retry.ok, true);
  if (first.ok && retry.ok) assert.equal(retry.value.id, first.value.id);
  assert.equal(fake.successfulInsertCounts.get("tasks"), 1);
  assertExactOperationLookup(fake, "tasks");
});

test("reminder crash after effect: lease-expiry retry returns the original task with one reminder", async () => {
  const fake = new FakeSupabase();
  const repository = new SupabaseTasksRepository(asSupabase(fake));
  const input = {
    taskId: "task-a",
    remindAt: "2026-08-29T10:00:00.000Z",
    channel: "email" as const,
    status: "pending" as const,
    mcpOperationId: OPERATION_ID,
    mcpClientId: CLIENT_ID,
  };

  fake.push("task_reminders", { data: null, error: null });
  fake.push("tasks", { data: taskRow(), error: null });
  fake.push("task_reminders", { data: [reminderRow()], error: null });
  fake.push("task_recurrences", { data: [], error: null });
  fake.push("task_sessions", { data: [], error: null });
  const first = await repository.createReminder(ACTOR, input);
  assert.equal(first.ok, true);

  // Reminder INSERT committed; receipt.store was lost with the worker.
  fake.push("task_reminders", {
    data: null,
    error: uniqueError("task_reminders_mcp_operation_unique"),
  });
  fake.push("task_reminders", { data: { task_id: "task-a" }, error: null });
  fake.push("tasks", { data: taskRow(), error: null });
  fake.push("task_reminders", { data: [reminderRow()], error: null });
  fake.push("task_recurrences", { data: [], error: null });
  fake.push("task_sessions", { data: [], error: null });
  const retry = await repository.createReminder(ACTOR, input);

  assert.equal(first.ok && retry.ok, true);
  if (first.ok && retry.ok) {
    assert.equal(retry.value.id, first.value.id);
    assert.equal(retry.value.reminders[0]?.id, "reminder-a");
  }
  assert.equal(fake.successfulInsertCounts.get("task_reminders"), 1);
  assertExactOperationLookup(fake, "task_reminders");
});

test("session crash after effect: lease-expiry retry returns the original open session", async () => {
  const fake = new FakeSupabase();
  const repository = new SupabaseTimerSessionRepository(asSupabase(fake));
  const input = {
    taskId: "task-a",
    startedAtIso: "2026-08-28T10:00:00.000Z",
    mcpOperationId: OPERATION_ID,
    mcpClientId: CLIENT_ID,
  };

  fake.push("task_sessions", { data: sessionRow(), error: null });
  const first = await repository.insertOpenSession(ACTOR, input);
  assert.equal(first.ok, true);

  // The session INSERT committed, then the receipt was lost before lease expiry.
  fake.push("task_sessions", {
    data: null,
    error: uniqueError("task_sessions_mcp_operation_unique"),
  });
  fake.push("task_sessions", { data: sessionRow(), error: null });
  const retry = await repository.insertOpenSession(ACTOR, input);

  assert.equal(first.ok && retry.ok, true);
  if (first.ok && retry.ok) assert.equal(retry.value.id, first.value.id);
  assert.equal(fake.successfulInsertCounts.get("task_sessions"), 1);
  assertExactOperationLookup(fake, "task_sessions");
});

test("two concurrent project creates produce one domain row", async () => {
  const fake = new ConcurrentFakeSupabase();
  const repository = new SupabaseProjectsRepository(asSupabase(fake));
  const input = {
    name: "Kitchen",
    slug: "kitchen",
    description: null,
    mcpOperationId: OPERATION_ID,
    mcpClientId: CLIENT_ID,
  };

  const [first, second] = await Promise.all([
    repository.createProject(ACTOR, input),
    repository.createProject(ACTOR, input),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(fake.count("projects"), 1);
  assert.equal(fake.successfulInsertCounts.get("projects"), 1);
});

test("two concurrent goal creates produce one canonical goal", async () => {
  const fake = new ConcurrentFakeSupabase();
  const repository = new SupabaseGoalsRepository(asSupabase(fake));
  const input = {
    title: "Finish the kitchen",
    projectId: "project-a",
    description: "Cabinets",
    nextStep: "Order the countertop",
    health: "on_track" as const,
    status: "active" as const,
    slug: "finish-the-kitchen",
    mcpOperationId: OPERATION_ID,
    mcpClientId: CLIENT_ID,
  };

  const [first, second] = await Promise.all([
    repository.createGoal(ACTOR, input),
    repository.createGoal(ACTOR, input),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) assert.equal(first.value?.id, second.value?.id);
  assert.equal(fake.count("goals"), 1);
  assert.equal(fake.successfulInsertCounts.get("goals"), 1);
});

test("two concurrent task creates produce one canonical task", async () => {
  const fake = new ConcurrentFakeSupabase();
  const repository = new SupabaseTasksRepository(asSupabase(fake));
  const input = {
    title: "Measure the wall",
    projectId: "project-a",
    goalId: null,
    description: null,
    blockedReason: null,
    status: "todo" as const,
    priority: "medium" as const,
    dueDate: null,
    estimateMinutes: 30,
    mcpOperationId: OPERATION_ID,
    mcpClientId: CLIENT_ID,
  };

  const [first, second] = await Promise.all([
    repository.createTask(ACTOR, input),
    repository.createTask(ACTOR, input),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) assert.equal(first.value.id, second.value.id);
  assert.equal(fake.count("tasks"), 1);
  assert.equal(fake.successfulInsertCounts.get("tasks"), 1);
});

test("two concurrent reminder creates produce one reminder effect", async () => {
  const fake = new ConcurrentFakeSupabase();
  fake.seed("tasks", { ...taskRow(), owner_user_id: ACTOR.userId });
  const repository = new SupabaseTasksRepository(asSupabase(fake));
  const input = {
    taskId: "task-a",
    remindAt: "2026-08-29T10:00:00.000Z",
    channel: "email" as const,
    status: "pending" as const,
    mcpOperationId: OPERATION_ID,
    mcpClientId: CLIENT_ID,
  };

  const [first, second] = await Promise.all([
    repository.createReminder(ACTOR, input),
    repository.createReminder(ACTOR, input),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(first.value.id, second.value.id);
    assert.equal(first.value.reminders.length, 1);
    assert.equal(second.value.reminders.length, 1);
  }
  assert.equal(fake.count("task_reminders"), 1);
  assert.equal(fake.successfulInsertCounts.get("task_reminders"), 1);
});

test("two concurrent session starts produce one canonical open session", async () => {
  const fake = new ConcurrentFakeSupabase();
  const repository = new SupabaseTimerSessionRepository(asSupabase(fake));
  const input = {
    taskId: "task-a",
    startedAtIso: "2026-08-28T10:00:00.000Z",
    mcpOperationId: OPERATION_ID,
    mcpClientId: CLIENT_ID,
  };

  const [first, second] = await Promise.all([
    repository.insertOpenSession(ACTOR, input),
    repository.insertOpenSession(ACTOR, input),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) assert.equal(first.value.id, second.value.id);
  assert.equal(fake.count("task_sessions"), 1);
  assert.equal(fake.successfulInsertCounts.get("task_sessions"), 1);
});

test("unrelated unique violations remain failures instead of false replays", async () => {
  const fake = new FakeSupabase();
  const repository = new SupabaseGoalsRepository(asSupabase(fake));
  fake.push("goals", { data: null, error: uniqueError("goals_project_slug_unique") });

  const result = await repository.createGoal(ACTOR, {
    title: "Another goal",
    projectId: "project-a",
    description: null,
    nextStep: null,
    health: null,
    status: "draft",
    slug: "same-slug",
    mcpOperationId: OPERATION_ID,
    mcpClientId: CLIENT_ID,
  });

  assert.equal(result.ok, false);
  assert.equal(fake.calls.filter((call) => call.table === "goals").length, 1);
});
