import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SupabaseArchiveRepository,
  SupabaseGoalsRepository,
  SupabaseProjectsRepository,
  excludeArchivedAncestry,
  isSupabaseForeignKeyViolation,
  loadArchivedAncestorScope,
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

  or(filters: string) {
    this.steps.push({ method: "or", args: [filters] });
    return this;
  }

  ilike(column: string, pattern: string) {
    this.steps.push({ method: "ilike", args: [column, pattern] });
    return this;
  }

  limit(count: number) {
    this.steps.push({ method: "limit", args: [count] });
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

function archiveRepository(fake: FakeSupabase) {
  return new SupabaseArchiveRepository(fake as unknown as SupabaseClient);
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
        area_id: null,
        areas: null,
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
      areaId: null,
      areaName: null,
      areaColor: null,
      areaIcon: null,
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
    area_id: null,
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
  assert.ok(steps.some((step) => step.method === "is" && step.args[0] === "archived_at" && step.args[1] === null));
});

test("listTasksForProjects can include archived tasks for the delete precondition", async () => {
  const fake = fakeSupabase();
  fake.pushResult("tasks", { data: [], error: null });

  const result = await projectsRepository(fake).listTasksForProjects(
    ACTOR,
    ["project-1"],
    { includeArchived: true },
  );

  assert.equal(result.ok, true);
  const steps = stepsFor(fake);
  assert.ok(!steps.some((step) => step.method === "is" && step.args[0] === "archived_at"));
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

const ARCHIVE_PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";
const ARCHIVE_GOAL_ID = "223e4567-e89b-12d3-a456-426614174000";

test("archive summary counts archived rows per owner", async () => {
  const fake = fakeSupabase();
  fake.pushResult("tasks", { data: null, error: null, count: 4 });
  fake.pushResult("goals", { data: null, error: null, count: 2 });
  fake.pushResult("projects", { data: null, error: null, count: 1 });

  const result = await archiveRepository(fake).getArchiveSummary(ACTOR);

  assert.deepEqual(result, { ok: true, value: { tasks: 4, goals: 2, projects: 1 } });

  for (const [index, table] of ["tasks", "goals", "projects"].entries()) {
    assert.equal(fake.calls[index]?.table, table);
    const steps = stepsFor(fake, index);
    assert.deepEqual(steps[0].args[0], "id");
    assert.deepEqual(steps[0].args[1], { count: "exact", head: true });
    assert.ok(
      steps.some(
        (step) =>
          step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123",
      ),
    );
    assert.ok(
      steps.some(
        (step) =>
          step.method === "not" &&
          step.args[0] === "archived_at" &&
          step.args[1] === "is" &&
          step.args[2] === null,
      ),
    );
  }
});

test("archive task list is archived-only, owner-scoped, ordered and search-escaped", async () => {
  const fake = fakeSupabase();
  fake.pushResult("tasks", {
    data: [
      {
        id: "task-1",
        title: "Ship 100% _done",
        status: "todo",
        priority: "high",
        project_id: ARCHIVE_PROJECT_ID,
        goal_id: ARCHIVE_GOAL_ID,
        archived_at: "2026-05-02T10:00:00.000Z",
        updated_at: "2026-05-02T10:00:00.000Z",
        projects: { name: "Platform", slug: "platform", archived_at: null },
        goals: { title: "Q2", archived_at: "2026-05-01T00:00:00.000Z" },
      },
      {
        id: "task-without-timestamp",
        title: "Not archived",
        status: "todo",
        priority: "low",
        project_id: ARCHIVE_PROJECT_ID,
        goal_id: null,
        archived_at: null,
        updated_at: "2026-05-02T10:00:00.000Z",
        projects: null,
        goals: null,
      },
    ],
    error: null,
  });

  const result = await archiveRepository(fake).listArchivedTasks(ACTOR, {
    search: "100% _done",
    limit: 25,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.length, 1);
  assert.deepEqual(result.value[0], {
    id: "task-1",
    title: "Ship 100% _done",
    status: "todo",
    priority: "high",
    projectId: ARCHIVE_PROJECT_ID,
    projectName: "Platform",
    projectSlug: "platform",
    projectArchived: false,
    goalId: ARCHIVE_GOAL_ID,
    goalTitle: "Q2",
    goalArchived: true,
    archivedAt: "2026-05-02T10:00:00.000Z",
    updatedAt: "2026-05-02T10:00:00.000Z",
  });

  const steps = stepsFor(fake);
  assert.ok(steps.some((step) => step.method === "eq" && step.args[1] === "user-123"));
  assert.ok(steps.some((step) => step.method === "not" && step.args[0] === "archived_at"));
  assert.deepEqual(
    steps.find((step) => step.method === "ilike")?.args,
    ["title", "%100\\% \\_done%"],
  );
  assert.deepEqual(
    steps.find((step) => step.method === "order")?.args,
    ["archived_at", { ascending: false }],
  );
  assert.deepEqual(steps.find((step) => step.method === "limit")?.args, [25]);
});

test("archive goal and project lists stay owner-scoped and archived-only", async () => {
  const fake = fakeSupabase();
  fake.pushResult("goals", {
    data: [
      {
        id: ARCHIVE_GOAL_ID,
        title: "Q2",
        status: "archived",
        project_id: ARCHIVE_PROJECT_ID,
        archived_at: "2026-05-02T10:00:00.000Z",
        updated_at: "2026-05-02T10:00:00.000Z",
        projects: { name: "Platform", archived_at: null },
      },
    ],
    error: null,
  });
  fake.pushResult("projects", {
    data: [
      {
        id: ARCHIVE_PROJECT_ID,
        name: "Platform",
        slug: "platform",
        archived_at: "2026-05-02T10:00:00.000Z",
        updated_at: "2026-05-02T10:00:00.000Z",
      },
    ],
    error: null,
  });

  const goals = await archiveRepository(fake).listArchivedGoals(ACTOR, { search: "", limit: 10 });
  const projects = await archiveRepository(fake).listArchivedProjects(ACTOR, {
    search: "plat",
    limit: 10,
  });

  assert.equal(goals.ok, true);
  assert.equal(projects.ok, true);
  if (!goals.ok || !projects.ok) return;
  assert.equal(goals.value[0]?.projectArchived, false);
  assert.equal(projects.value[0]?.name, "Platform");
  assert.ok(stepsFor(fake, 0).some((step) => step.method === "eq" && step.args[1] === "user-123"));
  assert.ok(stepsFor(fake, 1).some((step) => step.method === "ilike"));
  assert.ok(stepsFor(fake, 1).some((step) => step.method === "eq" && step.args[1] === "user-123"));
});

test("project archive state writes the marker, attribution and status together", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: null });
  fake.pushResult("projects", { data: null, error: null });

  const repository = projectsRepository(fake);
  await repository.updateProjectArchiveState(ACTOR, {
    projectId: ARCHIVE_PROJECT_ID,
    archivedAt: "2026-05-02T10:00:00.000Z",
    updatedAt: "2026-05-02T10:00:00.000Z",
  });
  await repository.updateProjectArchiveState(ACTOR, {
    projectId: ARCHIVE_PROJECT_ID,
    archivedAt: null,
    updatedAt: "2026-05-03T10:00:00.000Z",
  });

  const archivedSteps = stepsFor(fake, 0);
  assert.deepEqual(archivedSteps.find((step) => step.method === "update")?.args[0], {
    status: "archived",
    archived_at: "2026-05-02T10:00:00.000Z",
    archived_by: "user-123",
    updated_at: "2026-05-02T10:00:00.000Z",
  });
  assert.ok(
    archivedSteps.some(
      (step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123",
    ),
  );

  assert.deepEqual(stepsFor(fake, 1).find((step) => step.method === "update")?.args[0], {
    status: "active",
    archived_at: null,
    archived_by: null,
    updated_at: "2026-05-03T10:00:00.000Z",
  });
});

test("goal archive state writes the marker, attribution and status together", async () => {
  const fake = fakeSupabase();
  fake.pushResult("goals", { data: null, error: null });

  await goalsRepository(fake).updateGoalArchiveState(ACTOR, {
    goalId: ARCHIVE_GOAL_ID,
    archivedAt: "2026-05-02T10:00:00.000Z",
    updatedAt: "2026-05-02T10:00:00.000Z",
  });

  assert.deepEqual(stepsFor(fake).find((step) => step.method === "update")?.args[0], {
    status: "archived",
    archived_at: "2026-05-02T10:00:00.000Z",
    archived_by: "user-123",
    updated_at: "2026-05-02T10:00:00.000Z",
  });
});

test("parent archive guard reads open sessions only for the owner's scoped tasks", async () => {
  const fake = fakeSupabase();
  fake.pushResult("tasks", { data: [{ id: "task-1" }, { id: "task-2" }], error: null });
  fake.pushResult("task_sessions", { data: [{ id: "session-1" }], error: null });

  const result = await projectsRepository(fake).hasOpenTaskSessionForProject(ACTOR, ARCHIVE_PROJECT_ID);

  assert.deepEqual(result, { ok: true, value: true });
  const taskSteps = stepsFor(fake, 0);
  assert.ok(taskSteps.some((step) => step.method === "eq" && step.args[0] === "project_id"));
  assert.ok(taskSteps.some((step) => step.method === "eq" && step.args[1] === "user-123"));

  const sessionSteps = stepsFor(fake, 1);
  assert.deepEqual(
    sessionSteps.find((step) => step.method === "in")?.args,
    ["task_id", ["task-1", "task-2"]],
  );
  assert.ok(
    sessionSteps.some(
      (step) =>
        step.method === "is" && step.args[0] === "ended_at" && step.args[1] === null,
    ),
  );
});

test("archived ancestor scope is owner-scoped and only accepts uuid ids", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: [{ id: ARCHIVE_PROJECT_ID }], error: null });
  fake.pushResult("goals", { data: [{ id: ARCHIVE_GOAL_ID }, { id: "not-a-uuid" }], error: null });

  const result = await loadArchivedAncestorScope(
    fake as unknown as SupabaseClient,
    "user-123",
  );

  assert.deepEqual(result, {
    ok: true,
    value: { projectIds: [ARCHIVE_PROJECT_ID], goalIds: [ARCHIVE_GOAL_ID] },
  });
  assert.ok(stepsFor(fake, 0).some((step) => step.method === "eq" && step.args[1] === "user-123"));
});

test("archived ancestor scope falls back to the status marker before 0073", async () => {
  const fake = fakeSupabase();
  const missingColumn = {
    code: "42703",
    message: 'column "archived_at" does not exist',
  };
  fake.pushResult("projects", { data: null, error: missingColumn });
  fake.pushResult("goals", { data: null, error: missingColumn });
  fake.pushResult("projects", { data: [{ id: ARCHIVE_PROJECT_ID }], error: null });
  fake.pushResult("goals", { data: [{ id: ARCHIVE_GOAL_ID }, { id: "not-a-uuid" }], error: null });

  const result = await loadArchivedAncestorScope(
    fake as unknown as SupabaseClient,
    "user-123",
  );

  assert.deepEqual(result, {
    ok: true,
    value: { projectIds: [ARCHIVE_PROJECT_ID], goalIds: [ARCHIVE_GOAL_ID] },
  });
  const projectReads = fake.calls.filter((call) => call.table === "projects");
  assert.ok(
    projectReads[0]?.steps.some(
      (step) => step.method === "not" && step.args[0] === "archived_at",
    ),
  );
  assert.ok(
    projectReads[1]?.steps.some(
      (step) => step.method === "eq" && step.args[0] === "status" && step.args[1] === "archived",
    ),
  );
  assert.ok(
    projectReads[1]?.steps.some(
      (step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123",
    ),
  );
});

test("archived ancestor scope does not hide unrelated query failures", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", {
    data: null,
    error: { code: "42501", message: "permission denied for table projects" },
  });
  fake.pushResult("goals", { data: [], error: null });

  const result = await loadArchivedAncestorScope(
    fake as unknown as SupabaseClient,
    "user-123",
  );

  assert.deepEqual(result, { ok: false, error: { code: "unknown" } });
  assert.equal(fake.calls.filter((call) => call.table === "projects").length, 1);
});

test("ancestry exclusion keeps goal-less tasks and drops archived parents", async () => {
  const fake = fakeSupabase();
  fake.pushResult("tasks", { data: [], error: null });

  const query = excludeArchivedAncestry(fake.from("tasks"), {
    projectIds: [ARCHIVE_PROJECT_ID],
    goalIds: [ARCHIVE_GOAL_ID],
  });
  await query;

  const steps = stepsFor(fake);
  assert.deepEqual(
    steps.find((step) => step.method === "not")?.args,
    ["project_id", "in", `(${ARCHIVE_PROJECT_ID})`],
  );
  assert.deepEqual(steps.find((step) => step.method === "or")?.args, [
    `goal_id.is.null,goal_id.not.in.(${ARCHIVE_GOAL_ID})`,
  ]);
});

test("active goal list excludes archived project ancestry", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: [{ id: ARCHIVE_PROJECT_ID }], error: null });
  fake.pushResult("goals", { data: [], error: null });
  fake.pushResult("goals", { data: [], error: null });

  const result = await goalsRepository(fake).listGoals(ACTOR, "active");

  assert.deepEqual(result, { ok: true, value: [] });
  const listSteps = stepsFor(fake, 2);
  assert.ok(listSteps.some((step) => step.method === "neq" && step.args[1] === "archived"));
  assert.deepEqual(
    listSteps.find((step) => step.method === "not")?.args,
    ["project_id", "in", `(${ARCHIVE_PROJECT_ID})`],
  );
});

test("createProjectFromTemplate calls the template RPC with no owner id and parses a created receipt", async () => {
  const fake = fakeSupabase();
  fake.pushRpcResult("create_project_from_template", {
    data: {
      status: "created",
      project_id: "project-1",
      slug: "job-sprint",
      goal_count: 2,
      task_count: 7,
    },
    error: null,
  });

  const result = await projectsRepository(fake).createProjectFromTemplate(ACTOR, {
    operationId: "123e4567-e89b-12d3-a456-426614174000",
    templateId: "job-application-sprint",
    name: "Job sprint",
    slug: "job-sprint",
    description: null,
    goals: [{ title: "Pipeline", description: null, status: "active" }],
    tasks: [
      {
        goalIndex: 0,
        title: "List target roles",
        description: null,
        priority: "high",
        estimateMinutes: 45,
        dueDate: "2027-03-14",
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    projectId: "project-1",
    slug: "job-sprint",
    goalCount: 2,
    taskCount: 7,
    replayed: false,
  });

  assert.equal(fake.rpcCalls.length, 1);
  const call = fake.rpcCalls[0];
  assert.equal(call?.name, "create_project_from_template");
  assert.equal(call?.args.p_operation_id, "123e4567-e89b-12d3-a456-426614174000");
  assert.equal(call?.args.p_template_id, "job-application-sprint");
  assert.ok(!("p_owner_user_id" in (call?.args ?? {})));
});

test("createProjectFromTemplate treats a replay and a slug conflict as distinct outcomes", async () => {
  const replayFake = fakeSupabase();
  replayFake.pushRpcResult("create_project_from_template", {
    data: {
      status: "replayed",
      project_id: "project-existing",
      slug: "job-sprint",
      goal_count: 2,
      task_count: 7,
    },
    error: null,
  });

  const replay = await projectsRepository(replayFake).createProjectFromTemplate(ACTOR, {
    operationId: "123e4567-e89b-12d3-a456-426614174000",
    templateId: "blank",
    name: "Job sprint",
    slug: "job-sprint",
    description: null,
    goals: [],
    tasks: [],
  });
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.value.replayed, true);
  assert.equal(replay.value.projectId, "project-existing");

  const conflictFake = fakeSupabase();
  conflictFake.pushRpcResult("create_project_from_template", {
    data: { status: "slug_conflict" },
    error: null,
  });

  const conflict = await projectsRepository(conflictFake).createProjectFromTemplate(ACTOR, {
    operationId: "123e4567-e89b-12d3-a456-426614174000",
    templateId: "blank",
    name: "Job sprint",
    slug: "job-sprint",
    description: null,
    goals: [],
    tasks: [],
  });
  assert.equal(conflict.ok, false);
  if (conflict.ok) return;
  assert.deepEqual(conflict.error, { code: "conflict" });
});

test("createProjectFromTemplate fails closed on a malformed RPC receipt", async () => {
  for (const data of [
    null,
    { status: "created" },
    { status: "created", project_id: "project-1", slug: "x", goal_count: -1, task_count: 0 },
    { status: "created", project_id: "project-1", slug: "x", goal_count: 1, task_count: "2" },
    { status: "unexpected", project_id: "project-1", slug: "x", goal_count: 1, task_count: 2 },
  ]) {
    const fake = fakeSupabase();
    fake.pushRpcResult("create_project_from_template", { data, error: null });

    const result = await projectsRepository(fake).createProjectFromTemplate(ACTOR, {
      operationId: "123e4567-e89b-12d3-a456-426614174000",
      templateId: "blank",
      name: "Job sprint",
      slug: "job-sprint",
      description: null,
      goals: [],
      tasks: [],
    });

    assert.equal(result.ok, false, `expected failure for ${JSON.stringify(data)}`);
    if (result.ok) return;
    assert.deepEqual(result.error, { code: "unknown" });
  }
});
