import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SupabaseGoalsRepository,
  SupabaseProjectsRepository,
  isSupabaseForeignKeyViolation,
  sanitizeSupabaseError,
} from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count?: number | null;
};

type ChainStep = { method: string; args: unknown[] };

class FakeSupabase {
  private readonly queues = new Map<string, QueryResult[]>();
  calls: Array<{ table: string; steps: ChainStep[] }> = [];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  from(table: string) {
    return new FakeQueryBuilder(table, this);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    return {
      then: (fulfilled: (value: QueryResult) => unknown) =>
        Promise.resolve(this.popResult(`rpc:${name}`)).then(fulfilled),
    } as unknown as Promise<QueryResult>;
  }

  pushResult(table: string, result: QueryResult) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }

  pushRpcResult(name: string, result: QueryResult) {
    this.pushResult(`rpc:${name}`, result);
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

class FakeQueryBuilder {
  private readonly steps: ChainStep[] = [];

  constructor(
    private readonly table: string,
    private readonly supabase: FakeSupabase,
  ) {}

  select(columns: string) {
    this.steps.push({ method: "select", args: [columns] });
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

  in(column: string, values: unknown[]) {
    this.steps.push({ method: "in", args: [column, values] });
    return this;
  }

  is(column: string, value: unknown) {
    this.steps.push({ method: "is", args: [column, value] });
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    this.steps.push({ method: "not", args: [column, operator, value] });
    return this;
  }

  order(column: string, options?: unknown) {
    this.steps.push({ method: "order", args: [column, options] });
    return this;
  }

  maybeSingle() {
    this.steps.push({ method: "maybeSingle", args: [] });
    return this;
  }

  insert(payload: unknown) {
    this.steps.push({ method: "insert", args: [payload] });
    return this;
  }

  update(payload: unknown) {
    this.steps.push({ method: "update", args: [payload] });
    return this;
  }

  delete() {
    this.steps.push({ method: "delete", args: [] });
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

function fakeSupabase(): FakeSupabase {
  return new FakeSupabase();
}

function projectsRepository(fake: FakeSupabase) {
  return new SupabaseProjectsRepository(fake as unknown as SupabaseClient);
}

function goalsRepository(fake: FakeSupabase) {
  return new SupabaseGoalsRepository(fake as unknown as SupabaseClient);
}

function stepsFor(fake: FakeSupabase, index = 0) {
  return fake.calls[index]?.steps ?? [];
}

test("sanitizeSupabaseError maps only the deliberate failure set", () => {
  assert.deepEqual(sanitizeSupabaseError({ code: "23505" }), { code: "conflict" });
  assert.deepEqual(
    sanitizeSupabaseError(
      {
        message: 'duplicate key value violates unique constraint "projects_owner_user_id_slug_unique"',
      },
      { conflictMessageHint: "projects_owner_user_id_slug_unique" },
    ),
    { code: "conflict" },
  );
  assert.deepEqual(sanitizeSupabaseError({ code: "PGRST116" }), { code: "unknown" });
  assert.deepEqual(sanitizeSupabaseError(null), { code: "unknown" });
});

test("isSupabaseForeignKeyViolation recognizes only 23503 without leaking internals", () => {
  assert.equal(isSupabaseForeignKeyViolation({ code: "23503" }), true);
  assert.equal(isSupabaseForeignKeyViolation({ code: "23505" }), false);
  assert.equal(isSupabaseForeignKeyViolation(null), false);
  // The generic sanitizer stays unchanged: only the guarded delete path maps
  // 23503 to a conflict.
  assert.deepEqual(sanitizeSupabaseError({ code: "23503" }), { code: "unknown" });
});

test("listProjects maps rows, applies the view filter, and scopes by owner", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", {
    data: [
      {
        id: "project-1",
        name: "Home Renovation",
        slug: "home-renovation",
        description: "Kitchen",
        status: "active",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    ],
    error: null,
  });

  const result = await projectsRepository(fake).listProjects(ACTOR, "active");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, [
    {
      id: "project-1",
      name: "Home Renovation",
      slug: "home-renovation",
      description: "Kitchen",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
  ]);

  const steps = stepsFor(fake);
  assert.ok(steps.some((step) => step.method === "neq" && step.args[0] === "status"));
  assert.ok(
    steps.some(
      (step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123",
    ),
  );
});

test("listProjects sanitizes persistence errors", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: { code: "PGRST500" } });

  const result = await projectsRepository(fake).listProjects(ACTOR, "all");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, { code: "unknown" });
});

test("getProjectBySlug returns null for a missing row and scopes by owner", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: null });

  const result = await projectsRepository(fake).getProjectBySlug(ACTOR, "missing");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value, null);

  const steps = stepsFor(fake);
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "slug" && step.args[1] === "missing"));
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id"));
});

test("createProject scopes the insert by owner and maps 23505 to conflict", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: { code: "23505" } });

  const result = await projectsRepository(fake).createProject(ACTOR, {
    name: "Duplicate",
    slug: "duplicate",
    description: null,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, { code: "conflict" });

  const steps = stepsFor(fake);
  const insert = steps.find((step) => step.method === "insert");
  assert.ok(insert);
  assert.deepEqual(insert.args[0], {
    name: "Duplicate",
    slug: "duplicate",
    description: null,
    owner_user_id: "user-123",
  });
});

test("createProject maps the unique-constraint message hint to conflict", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", {
    data: null,
    error: { message: 'duplicate key value violates unique constraint "projects_owner_user_id_slug_unique"' },
  });

  const result = await projectsRepository(fake).createProject(ACTOR, {
    name: "Duplicate",
    slug: "duplicate",
    description: null,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, { code: "conflict" });
});

test("updateProjectStatus scopes the update by id and owner and sanitizes errors", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: { code: "PGRST500" } });

  const result = await projectsRepository(fake).updateProjectStatus(ACTOR, {
    projectId: "project-1",
    status: "paused",
    updatedAt: "2026-03-01T00:00:00.000Z",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, { code: "unknown" });

  const steps = stepsFor(fake);
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "id" && step.args[1] === "project-1"));
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"));
  const update = steps.find((step) => step.method === "update");
  assert.ok(update);
  assert.deepEqual(update.args[0], {
    status: "paused",
    updated_at: "2026-03-01T00:00:00.000Z",
  });
});

test("getProjectById scopes the lookup by id and owner", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", {
    data: {
      id: "project-1",
      name: "Home Renovation",
      slug: "home-renovation",
      description: null,
      status: "archived",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    },
    error: null,
  });

  const result = await projectsRepository(fake).getProjectById(ACTOR, "project-1");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value?.id, "project-1");
  assert.equal(result.value?.status, "archived");

  const steps = stepsFor(fake);
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "id" && step.args[1] === "project-1"));
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"));
});

test("deleteArchivedProject scopes the delete by id, owner, and archived status", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: [{ id: "project-1" }], error: null });

  const result = await projectsRepository(fake).deleteArchivedProject(ACTOR, { projectId: "project-1" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, { deleted: true });

  const steps = stepsFor(fake);
  assert.ok(steps.some((step) => step.method === "delete"));
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "id" && step.args[1] === "project-1"));
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"));
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "status" && step.args[1] === "archived"));
});

test("deleteArchivedProject maps a 23503 foreign-key refusal to conflict", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", {
    data: null,
    error: {
      code: "23503",
      message: 'insert or update on table "tasks" violates foreign key constraint "tasks_project_id_projects_id_fk"',
    },
  });

  const result = await projectsRepository(fake).deleteArchivedProject(ACTOR, { projectId: "project-1" });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, { code: "conflict" });
});

test("deleteArchivedProject reports a zero-row delete instead of claiming success", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: [], error: null });

  const result = await projectsRepository(fake).deleteArchivedProject(ACTOR, { projectId: "project-1" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, { deleted: false });
});

test("deleteArchivedProject sanitizes non-constraint failures", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: { code: "PGRST500" } });

  const result = await projectsRepository(fake).deleteArchivedProject(ACTOR, { projectId: "project-1" });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, { code: "unknown" });
});

const PURGE_PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";

test("getProjectPurgePreview scopes every query by owner and maps counts", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", {
    data: { id: PURGE_PROJECT_ID, name: "Stage CGI" },
    error: null,
  });
  fake.pushResult("tasks", {
    data: [
      { id: "task-1", calendar_event_id: "event-1" },
      { id: "task-2", calendar_event_id: null },
    ],
    error: null,
  });
  fake.pushResult("goals", { data: [{ id: "goal-1" }], error: null });
  fake.pushResult("task_sessions", { data: null, error: null, count: 3 });
  fake.pushResult("task_sessions", { data: null, error: null, count: 1 });
  fake.pushResult("task_reminders", { data: null, error: null, count: 2 });
  fake.pushResult("task_recurrences", { data: null, error: null, count: 1 });
  fake.pushResult("task_external_refs", { data: null, error: null, count: 1 });
  fake.pushResult("notifications", { data: null, error: null, count: 2 });

  const result = await projectsRepository(fake).getProjectPurgePreview(ACTOR, PURGE_PROJECT_ID);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    projectId: PURGE_PROJECT_ID,
    projectName: "Stage CGI",
    taskCount: 2,
    goalCount: 1,
    sessionCount: 3,
    activeSessionCount: 1,
    reminderCount: 2,
    recurrenceCount: 1,
    externalRefCount: 1,
    taskNotificationCount: 2,
    calendarEventCount: 1,
  });

  for (const call of fake.calls) {
    assert.ok(
      call.steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"),
      `owner scope missing on ${call.table}`,
    );
  }

  const sessionCalls = fake.calls.filter((call) => call.table === "task_sessions");
  assert.equal(sessionCalls.length, 2);
  assert.ok(sessionCalls[1].steps.some((step) => step.method === "is" && step.args[0] === "ended_at"));
  const notificationCall = fake.calls.find((call) => call.table === "notifications");
  assert.ok(notificationCall?.steps.some((step) => step.method === "eq" && step.args[0] === "target_type" && step.args[1] === "task"));
});

test("getProjectPurgePreview returns null for a foreign project without leaking", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: null });

  const result = await projectsRepository(fake).getProjectPurgePreview(ACTOR, PURGE_PROJECT_ID);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value, null);
  assert.equal(fake.calls.length, 1);
});

test("getProjectPurgePreview sanitizes count failures", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", {
    data: { id: PURGE_PROJECT_ID, name: "Stage CGI" },
    error: null,
  });
  fake.pushResult("tasks", {
    data: [{ id: "task-1", calendar_event_id: null }],
    error: null,
  });
  fake.pushResult("goals", { data: [], error: null });
  fake.pushResult("task_sessions", { data: null, error: { code: "PGRST500" } });

  const result = await projectsRepository(fake).getProjectPurgePreview(ACTOR, PURGE_PROJECT_ID);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, { code: "unknown" });
});

test("purgeArchivedProject calls the purge RPC without any owner id", async () => {
  const fake = fakeSupabase();
  fake.pushRpcResult("purge_archived_project", {
    data: {
      status: "purged",
      tasks_deleted: 2,
      goals_deleted: 1,
      sessions_deleted: 3,
      external_refs_deleted: 1,
      notifications_deleted: 2,
      calendar_delete_jobs_enqueued: 1,
    },
    error: null,
  });

  const result = await projectsRepository(fake).purgeArchivedProject(ACTOR, {
    projectId: PURGE_PROJECT_ID,
    confirmationName: "Stage CGI",
    expectedTaskCount: 2,
    expectedGoalCount: 1,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    status: "purged",
    tasksDeleted: 2,
    goalsDeleted: 1,
    sessionsDeleted: 3,
    externalRefsDeleted: 1,
    notificationsDeleted: 2,
    calendarDeleteJobsEnqueued: 1,
  });

  assert.equal(fake.rpcCalls.length, 1);
  assert.deepEqual(fake.rpcCalls[0], {
    name: "purge_archived_project",
    args: {
      p_project_id: PURGE_PROJECT_ID,
      p_confirmation_name: "Stage CGI",
      p_expected_task_count: 2,
      p_expected_goal_count: 1,
    },
  });
  assert.ok(!("p_owner_user_id" in fake.rpcCalls[0].args));
});

test("purgeArchivedProject maps typed RPC outcomes without leaking details", async () => {
  for (const status of ["not_found", "not_archived", "confirmation_mismatch", "contents_changed"]) {
    const fake = fakeSupabase();
    fake.pushRpcResult("purge_archived_project", { data: { status }, error: null });

    const result = await projectsRepository(fake).purgeArchivedProject(ACTOR, {
      projectId: PURGE_PROJECT_ID,
      confirmationName: "Stage CGI",
      expectedTaskCount: 2,
      expectedGoalCount: 1,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, { status });
  }
});

test("purgeArchivedProject fails closed on RPC errors and malformed results", async () => {
  const errored = fakeSupabase();
  errored.pushRpcResult("purge_archived_project", {
    data: null,
    error: { code: "42501", message: "permission denied" },
  });

  const errorResult = await projectsRepository(errored).purgeArchivedProject(ACTOR, {
    projectId: PURGE_PROJECT_ID,
    confirmationName: "Stage CGI",
    expectedTaskCount: 2,
    expectedGoalCount: 1,
  });

  assert.equal(errorResult.ok, false);
  if (errorResult.ok) return;
  assert.deepEqual(errorResult.error, { code: "unknown" });

  for (const data of [null, "purged", { status: "purged" }, { status: "purged", tasks_deleted: -1 }]) {
    const fake = fakeSupabase();
    fake.pushRpcResult("purge_archived_project", { data, error: null });

    const result = await projectsRepository(fake).purgeArchivedProject(ACTOR, {
      projectId: PURGE_PROJECT_ID,
      confirmationName: "Stage CGI",
      expectedTaskCount: 2,
      expectedGoalCount: 1,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.error, { code: "unknown" });
  }
});

test("listTasksForProjects scopes the task query by owner", async () => {
  const fake = fakeSupabase();
  fake.pushResult("tasks", {
    data: [
      { id: "task-1", project_id: "project-1", title: "Paint", status: "done", priority: "high", updated_at: "2026-02-02T00:00:00.000Z" },
    ],
    error: null,
  });

  const result = await projectsRepository(fake).listTasksForProjects(ACTOR, ["project-1"]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, [
    { id: "task-1", projectId: "project-1", title: "Paint", status: "done", priority: "high", updatedAt: "2026-02-02T00:00:00.000Z" },
  ]);

  const steps = stepsFor(fake);
  assert.ok(steps.some((step) => step.method === "in" && step.args[0] === "project_id" && Array.isArray(step.args[1]) && step.args[1][0] === "project-1"));
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id"));
});

test("listGoals maps rows, applies the view filter, and scopes by owner", async () => {
  const fake = fakeSupabase();
  fake.pushResult("goals", {
    data: [
      {
        id: "goal-1",
        project_id: "project-1",
        title: "Finish kitchen",
        slug: "finish-kitchen",
        description: "Cabinets",
        next_step: "Order countertop",
        health: "on_track",
        status: "active",
        created_at: "2026-01-10T00:00:00.000Z",
        updated_at: "2026-02-10T00:00:00.000Z",
      },
    ],
    error: null,
  });

  const result = await goalsRepository(fake).listGoals(ACTOR, "archived");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, [
    {
      id: "goal-1",
      projectId: "project-1",
      title: "Finish kitchen",
      slug: "finish-kitchen",
      description: "Cabinets",
      nextStep: "Order countertop",
      health: "on_track",
      status: "active",
      createdAt: "2026-01-10T00:00:00.000Z",
      updatedAt: "2026-02-10T00:00:00.000Z",
    },
  ]);

  const steps = stepsFor(fake);
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "status" && step.args[1] === "archived"));
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id"));
});

test("createGoal scopes the insert by owner", async () => {
  const fake = fakeSupabase();
  fake.pushResult("goals", { data: null, error: null });

  const result = await goalsRepository(fake).createGoal(ACTOR, {
    title: "Finish kitchen",
    projectId: "project-1",
    description: null,
    nextStep: "Order countertop",
    health: "on_track",
    status: "active",
    slug: "finish-kitchen",
  });

  assert.equal(result.ok, true);

  const steps = stepsFor(fake);
  const insert = steps.find((step) => step.method === "insert");
  assert.ok(insert);
  assert.deepEqual(insert.args[0], {
    title: "Finish kitchen",
    project_id: "project-1",
    description: null,
    next_step: "Order countertop",
    health: "on_track",
    status: "active",
    slug: "finish-kitchen",
    owner_user_id: "user-123",
  });
});

test("goal updates scope by owner and sanitize errors", async () => {
  const fake = fakeSupabase();
  fake.pushResult("goals", { data: null, error: { code: "PGRST500" } });

  const result = await goalsRepository(fake).updateGoalNextStep(ACTOR, {
    goalId: "goal-1",
    nextStep: "Call the architect",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, { code: "unknown" });

  const steps = stepsFor(fake);
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "id" && step.args[1] === "goal-1"));
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id"));
});

test("listGoalTasks keeps only rows with a goal id and scopes by owner", async () => {
  const fake = fakeSupabase();
  fake.pushResult("tasks", {
    data: [
      { id: "task-1", title: "Paint", status: "done", goal_id: "goal-1" },
      { id: "task-2", title: "Orphan", status: "todo", goal_id: null },
    ],
    error: null,
  });

  const result = await goalsRepository(fake).listGoalTasks(ACTOR);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, [{ id: "task-1", title: "Paint", status: "done", goalId: "goal-1" }]);

  const steps = stepsFor(fake);
  assert.ok(steps.some((step) => step.method === "not" && step.args[0] === "goal_id"));
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id"));
});
