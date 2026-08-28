import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseInboxRepository } from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");

type Result = { data: unknown; error: { code?: string; message?: string } | null };
type Step = { method: string; args: unknown[] };

class FakeSupabase {
  queues = new Map<string, Result[]>();
  calls: Array<{ table: string; steps: Step[] }> = [];
  from(table: string) {
    return new Builder(table, this);
  }
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
  select(...args: unknown[]) {
    this.steps.push({ method: "select", args });
    return this;
  }
  eq(...args: unknown[]) {
    this.steps.push({ method: "eq", args });
    return this;
  }
  neq(...args: unknown[]) {
    this.steps.push({ method: "neq", args });
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
  or(...args: unknown[]) {
    this.steps.push({ method: "or", args });
    return this;
  }
  contains(...args: unknown[]) {
    this.steps.push({ method: "contains", args });
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
  update(...args: unknown[]) {
    this.steps.push({ method: "update", args });
    return this;
  }
  maybeSingle(...args: unknown[]) {
    this.steps.push({ method: "maybeSingle", args });
    return this;
  }
  single(...args: unknown[]) {
    this.steps.push({ method: "single", args });
    return this;
  }
  then<TResult1, TResult2>(
    fulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.fake.calls.push({ table: this.table, steps: this.steps });
    return Promise.resolve(this.fake.pop(this.table)).then(fulfilled, rejected);
  }
}

function repository(fake: FakeSupabase) {
  return new SupabaseInboxRepository(fake as unknown as SupabaseClient);
}

function inboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "inbox-1",
    title: "Inbox thought",
    body: null,
    status: "inbox",
    type: "idea",
    project_id: null,
    priority: null,
    tags: [],
    created_at: "2026-04-29T12:00:00.000Z",
    updated_at: "2026-04-29T12:00:00.000Z",
    projects: null,
    ...overrides,
  };
}

test("inbox list is owner scoped and excludes converted by default (active view)", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", { data: [inboxRow()], error: null });

  const result = await repository(fake).listInboxItems(ACTOR, { view: "active" });

  assert.equal(result.ok, true);
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
  assert.ok(fake.calls[0].steps.some((s) => s.method === "in" && s.args[0] === "status" && (s.args[1] as string[]).includes("inbox")));
  // converted should not be in active view
  const inStep = fake.calls[0].steps.find((s) => s.method === "in" && s.args[0] === "status");
  assert.ok(inStep);
  assert.equal(((inStep as any).args[1] as string[]).includes("converted"), false);
});

test("inbox list archived view scopes correctly", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", { data: [inboxRow({ status: "archived" })], error: null });

  const result = await repository(fake).listInboxItems(ACTOR, { view: "archived" });
  assert.equal(result.ok, true);
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "status" && s.args[1] === "archived"));
});

test("inbox list all view includes archived but not converted", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", { data: [], error: null });

  const result = await repository(fake).listInboxItems(ACTOR, { view: "all" });
  assert.equal(result.ok, true);
  const inStep = fake.calls[0].steps.find((s) => s.method === "in" && s.args[0] === "status");
  assert.ok(inStep);
  const values = (inStep as any).args[1] as string[];
  assert.ok(values.includes("archived"));
  assert.ok(values.includes("inbox"));
  assert.equal(values.includes("converted"), false);
});

test("inbox list filters by type status project priority tag and search with owner scoping", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", { data: [inboxRow()], error: null });

  const result = await repository(fake).listInboxItems(ACTOR, {
    search: "timer",
    type: "bug",
    status: "planned",
    projectId: "11111111-1111-4111-8111-111111111111",
    priority: "high",
    tag: "ops",
  });

  assert.equal(result.ok, true);
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "type" && s.args[1] === "bug"));
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "status" && s.args[1] === "planned"));
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "project_id" && s.args[1] === "11111111-1111-4111-8111-111111111111"));
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "priority" && s.args[1] === "high"));
  assert.ok(fake.calls[0].steps.some((s) => s.method === "contains" && s.args[0] === "tags"));
  assert.ok(fake.calls[0].steps.some((s) => s.method === "or"));
});

test("inbox list filters for none project and none priority", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", { data: [], error: null });
  await repository(fake).listInboxItems(ACTOR, { projectFilter: "none" } as any);
  assert.ok(fake.calls[0].steps.some((s) => s.method === "is" && s.args[0] === "project_id"));

  const fake2 = new FakeSupabase();
  fake2.push("idea_notes", { data: [], error: null });
  await repository(fake2).listInboxItems(ACTOR, { priorityFilter: "none" } as any);
  assert.ok(fake2.calls[0].steps.some((s) => s.method === "is" && s.args[0] === "priority"));
});

test("inbox create sets owner_user_id and returns inserted row", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", { data: inboxRow(), error: null });

  const result = await repository(fake).createInboxItem(ACTOR, {
    title: "Idea",
    body: null,
    type: "idea",
    projectId: null,
    priority: null,
    tags: [],
  });

  assert.equal(result.ok, true);
  const insert = fake.calls[0].steps.find((s) => s.method === "insert");
  assert.ok(insert);
  assert.equal((insert as any).args[0].owner_user_id, "user-123");
});

test("inbox update and archive are owner scoped via id + owner_user_id", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", { data: inboxRow(), error: null });
  await repository(fake).updateInboxItem(ACTOR, {
    id: "inbox-1",
    title: "Updated",
    body: null,
    type: "idea",
    projectId: null,
    priority: null,
    tags: [],
    status: "reviewing",
  });
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "id" && s.args[1] === "inbox-1"));
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));

  const fake2 = new FakeSupabase();
  fake2.push("idea_notes", { data: inboxRow({ status: "archived" }), error: null });
  await repository(fake2).setInboxItemStatus(ACTOR, { id: "inbox-1", status: "archived" });
  assert.ok(fake2.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id"));
});

test("getScope reads projects with explicit actor ownership", async () => {
  const fake = new FakeSupabase();
  fake.push("projects", { data: [{ id: "project-1" }], error: null });
  const result = await repository(fake).getScope(ACTOR);
  assert.equal(result.ok, true);
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
});

test("getInboxItem is owner scoped and hydrates project name", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", { data: inboxRow({ id: "inbox-42", projects: { name: "Ops" } }), error: null });
  const result = await repository(fake).getInboxItem(ACTOR, "inbox-42");
  assert.equal(result.ok, true);
  assert.equal((result as any).value.projectName, "Ops");
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "id" && s.args[1] === "inbox-42"));
});

test("getTaskIdForInboxItem queries task_external_refs with owner and inbox source", async () => {
  const fake = new FakeSupabase();
  fake.push("task_external_refs", { data: { task_id: "task-123" }, error: null });
  const result = await repository(fake).getTaskIdForInboxItem(ACTOR, "inbox-1");
  assert.equal(result.ok, true);
  assert.equal((result as any).value, "task-123");
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "source" && s.args[1] === "inbox"));
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "source_id" && s.args[1] === "inbox-1"));
});

test("createInboxTaskLink inserts owner-scoped inbox mapping with conflict mapping", async () => {
  const fake = new FakeSupabase();
  fake.push("task_external_refs", { data: null, error: null });
  const result = await repository(fake).createInboxTaskLink(ACTOR, { inboxItemId: "inbox-1", taskId: "task-99" });
  assert.equal(result.ok, true);
  const insert = fake.calls[0].steps.find((s) => s.method === "insert");
  assert.ok(insert);
  assert.equal((insert.args[0] as any).owner_user_id, "user-123");
  assert.equal((insert.args[0] as any).source, "inbox");
  assert.equal((insert.args[0] as any).source_id, "inbox-1");
  assert.equal((insert.args[0] as any).task_id, "task-99");

  const fake2 = new FakeSupabase();
  fake2.push("task_external_refs", { data: null, error: { code: "23505", message: "duplicate key" } });
  const dup = await repository(fake2).createInboxTaskLink(ACTOR, { inboxItemId: "inbox-1", taskId: "task-99" });
  assert.equal(dup.ok, false);
  assert.equal((dup as any).error.code, "conflict");
});

test("markInboxItemConverted updates status to converted owner scoped", async () => {
  const fake = new FakeSupabase();
  fake.push("idea_notes", { data: inboxRow({ status: "converted" }), error: null });
  const result = await repository(fake).markInboxItemConverted(ACTOR, "inbox-1");
  assert.equal(result.ok, true);
  assert.equal((result as any).value.status, "converted");
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "id" && s.args[1] === "inbox-1"));
  const upd = fake.calls[0].steps.find((s) => s.method === "update");
  assert.ok(upd);
  assert.equal((upd.args[0] as any).status, "converted");
});
