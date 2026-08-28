import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveInboxItem,
  createAuthenticatedActor,
  createInboxItem,
  listInboxItems,
  restoreInboxItem,
  updateInboxItem,
  getInboxItem,
  type AuthenticatedActor,
  type CreateInboxRecordInput,
  type InboxRecord,
  type InboxRepository,
  type RepositoryResult,
} from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");
const OTHER_ACTOR = createAuthenticatedActor("user-999");

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

const TEST_PROJECT_ID = "11111111-1111-4111-8111-111111111111";

class FakeInboxRepository implements InboxRepository {
  calls: Array<{ method: string; actor: string; input?: unknown }> = [];
  scope: RepositoryResult<{ projectIds: string[] }> = ok({ projectIds: [TEST_PROJECT_ID] });
  list: RepositoryResult<InboxRecord[]> = ok([]);
  item: RepositoryResult<InboxRecord | null> = ok(null);
  mutation: RepositoryResult<InboxRecord> = ok({
    id: "inbox-1",
    title: "Inbox thought",
    body: null,
    status: "inbox",
    type: "idea",
    projectId: null,
    priority: null,
    tags: [],
    createdAt: "2026-04-29T12:00:00.000Z",
    updatedAt: "2026-04-29T12:00:00.000Z",
    projectName: null,
  });

  async getScope(actor: AuthenticatedActor) {
    this.calls.push({ method: "getScope", actor: actor.userId });
    return this.scope;
  }
  async listInboxItems(actor: AuthenticatedActor, query?: unknown) {
    this.calls.push({ method: "listInboxItems", actor: actor.userId, input: query });
    return this.list;
  }
  async listProjectOptions(actor: AuthenticatedActor) {
    this.calls.push({ method: "listProjectOptions", actor: actor.userId });
    return ok([{ id: TEST_PROJECT_ID, name: "Ops" }]);
  }
  async getInboxItem(actor: AuthenticatedActor, id: string) {
    this.calls.push({ method: "getInboxItem", actor: actor.userId, input: id });
    return this.item;
  }
  async getInboxItemByIdempotencyKey(actor: AuthenticatedActor, key: string) {
    this.calls.push({ method: "getInboxItemByIdempotencyKey", actor: actor.userId, input: key });
    return ok(null);
  }
  async createInboxItem(actor: AuthenticatedActor, input: CreateInboxRecordInput) {
    this.calls.push({ method: "createInboxItem", actor: actor.userId, input });
    return this.mutation;
  }
  async updateInboxItem(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "updateInboxItem", actor: actor.userId, input });
    return this.mutation;
  }
  async setInboxItemStatus(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "setInboxItemStatus", actor: actor.userId, input });
    return this.mutation;
  }
  async getTaskIdForInboxItem(actor: AuthenticatedActor, inboxItemId: string) {
    this.calls.push({ method: "getTaskIdForInboxItem", actor: actor.userId, input: inboxItemId });
    return ok(null as string | null);
  }
  async createInboxTaskLink(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "createInboxTaskLink", actor: actor.userId, input });
    return ok(undefined);
  }
  async markInboxItemConverted(actor: AuthenticatedActor, inboxItemId: string) {
    this.calls.push({ method: "markInboxItemConverted", actor: actor.userId, input: inboxItemId });
    return this.mutation;
  }
}

test("createInboxItem validates title and delegates normalized data with trusted actor", async () => {
  const repo = new FakeInboxRepository();
  const result = await createInboxItem(ACTOR, repo, {
    title: "  Improve timer handoff  ",
    body: "  useful context  ",
    type: "feature",
    projectId: TEST_PROJECT_ID,
    priority: "high",
    tagsInput: "Ops, product",
  });

  assert.equal(result.ok, true);
  assert.equal(repo.calls[0].method, "getScope");
  assert.equal(repo.calls[0].actor, "user-123");
  assert.equal(repo.calls[1].method, "createInboxItem");
  assert.deepEqual(repo.calls[1].input, {
    title: "Improve timer handoff",
    body: "useful context",
    type: "feature",
    projectId: TEST_PROJECT_ID,
    priority: "high",
    tags: ["ops", "product"],
  });
});

test("createInboxItem rejects empty title without touching repository", async () => {
  const repo = new FakeInboxRepository();
  const result = await createInboxItem(ACTOR, repo, { title: "   " });
  assert.equal(result.ok, false);
  assert.equal((result as any).errorMessage, "Title is required.");
  assert.equal(repo.calls.length, 0);
});

test("createInboxItem rejects invalid type priority project and tags before persistence", async () => {
  const cases = [
    { input: { title: "Idea", type: "task" }, error: "Choose a valid idea type." },
    { input: { title: "Idea", priority: "now" }, error: "Choose a valid priority." },
    { input: { title: "Idea", projectId: "not-a-uuid" }, error: "Project is invalid." },
    { input: { title: "Idea", tagsInput: "valid, #bad" }, error: "Tags can only use letters, numbers, spaces, hyphens, and underscores." },
  ];

  for (const c of cases) {
    const repo = new FakeInboxRepository();
    const result = await createInboxItem(ACTOR, repo, c.input);
    assert.equal(result.ok, false);
    assert.equal((result as any).errorMessage, c.error);
    assert.equal(repo.calls.length, 0);
  }
});

test("createInboxItem rejects unavailable project via scope check", async () => {
  const repo = new FakeInboxRepository();
  repo.scope = ok({ projectIds: ["22222222-2222-4222-8222-222222222222"] });
  const result = await createInboxItem(ACTOR, repo, {
    title: "Idea",
    projectId: TEST_PROJECT_ID,
  });
  assert.equal(result.ok, false);
  assert.equal((result as any).errorMessage, "Selected project is unavailable.");
  assert.equal(repo.calls.filter((c) => c.method === "createInboxItem").length, 0);
});

test("updateInboxItem edits metadata and validates manual status", async () => {
  const repo = new FakeInboxRepository();
  const result = await updateInboxItem(ACTOR, repo, {
    id: "inbox-1",
    title: "Updated",
    type: "research",
    projectId: TEST_PROJECT_ID,
    priority: "urgent",
    tagsInput: "Ops, Research",
    status: "planned",
  });
  assert.equal(result.ok, true);
  assert.equal(repo.calls[0].method, "getScope");
  assert.equal(repo.calls[1].method, "updateInboxItem");
  const payload = repo.calls[1].input as any;
  assert.equal(payload.status, "planned");
  assert.equal(payload.type, "research");
});

test("updateInboxItem rejects converted and invalid status without update", async () => {
  const repo = new FakeInboxRepository();
  const converted = await updateInboxItem(ACTOR, repo, { id: "inbox-1", title: "Idea", status: "converted" });
  assert.equal(converted.ok, false);
  assert.match((converted as any).errorMessage, /reserved/);

  const invalid = await updateInboxItem(ACTOR, repo, { id: "inbox-1", title: "Idea", status: "blocked" });
  assert.equal(invalid.ok, false);
  assert.equal((invalid as any).errorMessage, "Choose a valid status.");
  assert.equal(repo.calls.length, 0);
});

test("archive and restore use status port with actor scoping", async () => {
  const repo = new FakeInboxRepository();
  assert.equal((await archiveInboxItem(ACTOR, repo, { id: "inbox-1" })).ok, true);
  assert.equal((await restoreInboxItem(ACTOR, repo, { id: "inbox-1" })).ok, true);
  assert.deepEqual(repo.calls.map((c) => c.method), ["setInboxItemStatus", "setInboxItemStatus"]);
  assert.deepEqual(repo.calls[0].input, { id: "inbox-1", status: "archived" });
  assert.deepEqual(repo.calls[1].input, { id: "inbox-1", status: "inbox" });
});

test("get and list inbox items preserve actor and fail gracefully", async () => {
  const repo = new FakeInboxRepository();
  repo.item = ok({
    id: "inbox-1",
    title: "Idea",
    body: null,
    status: "inbox",
    type: "idea",
    projectId: null,
    priority: null,
    tags: [],
    createdAt: "2026-04-29T12:00:00.000Z",
    updatedAt: "2026-04-29T12:00:00.000Z",
    projectName: null,
  });
  repo.list = ok([(repo.item as any).value as InboxRecord]);

  const single = await getInboxItem(ACTOR, repo, "inbox-1");
  const list = await listInboxItems(ACTOR, repo, { view: "active" });

  assert.equal(single.ok, true);
  assert.equal((single as any).data.id, "inbox-1");
  assert.equal(list.ok, true);
  assert.equal((list as any).data.length, 1);
  assert.deepEqual(repo.calls.map((c) => c.actor), ["user-123", "user-123"]);

  // Cross-owner check: other actor should still be scoped via repo (repo would enforce)
  const otherRepo = new FakeInboxRepository();
  otherRepo.list = ok([]);
  const otherList = await listInboxItems(OTHER_ACTOR, otherRepo);
  assert.equal(otherList.ok, true);
  assert.equal(otherRepo.calls[0].actor, "user-999");
});

test("createInboxItem repo failure is sanitized", async () => {
  const repo = new FakeInboxRepository();
  repo.mutation = { ok: false, error: { code: "unknown" } };
  const result = await createInboxItem(ACTOR, repo, { title: "Idea" });
  assert.equal(result.ok, false);
  assert.equal((result as any).errorMessage, "Unable to create idea right now.");
});
