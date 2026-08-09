import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SupabaseGoalsRepository,
  SupabaseProjectsRepository,
  sanitizeSupabaseError,
} from "../src/index";

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
    return new FakeQueryBuilder(table, this);
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
