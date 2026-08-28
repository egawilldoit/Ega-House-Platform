import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthenticatedActor,
  createInboxItem,
  type AuthenticatedActor,
  type CreateInboxRecordInput,
  type InboxRecord,
  type InboxRepository,
  type RepositoryResult,
} from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

function fail(): RepositoryResult<never> {
  return { ok: false, error: { code: "unknown" } };
}

class FakeRepo implements InboxRepository {
  calls: Array<{ method: string; input?: unknown; actor?: string }> = [];
  // Store for idempotency simulation
  keyMap = new Map<string, InboxRecord>();
  created: InboxRecord[] = [];
  scopeResult: RepositoryResult<{ projectIds: string[] }> = ok({ projectIds: [] });
  idCounter = 0;

  async getScope(actor: AuthenticatedActor) {
    this.calls.push({ method: "getScope", actor: actor.userId });
    return this.scopeResult;
  }
  async listInboxItems() { return ok([] as InboxRecord[]); }
  async listProjectOptions(actor: AuthenticatedActor) {
    this.calls.push({ method: "listProjectOptions", actor: actor.userId });
    return ok([] as any);
  }
  async getInboxItem(actor: AuthenticatedActor, id: string) {
    this.calls.push({ method: "getInboxItem", input: id, actor: actor.userId });
    const found = this.created.find((r) => r.id === id) ?? this.keyMap.get(id);
    return ok((found as any) ?? null);
  }
  async getInboxItemByIdempotencyKey(actor: AuthenticatedActor, key: string) {
    this.calls.push({ method: "getInboxItemByIdempotencyKey", input: key, actor: actor.userId });
    const k = `${actor.userId}:${key}`;
    return ok(this.keyMap.get(k) ?? null);
  }
  async createInboxItem(actor: AuthenticatedActor, input: CreateInboxRecordInput) {
    this.calls.push({ method: "createInboxItem", input, actor: actor.userId });
    const key = (input as any).idempotencyKey ? String((input as any).idempotencyKey).trim() : null;
    if (key) {
      const mapKey = `${actor.userId}:${key}`;
      const existing = this.keyMap.get(mapKey);
      if (existing) {
        // Simulate dedup: return existing without creating new
        return ok(existing);
      }
    }
    this.idCounter += 1;
    const record: InboxRecord = {
      id: `inbox-${this.idCounter}`,
      title: input.title,
      body: input.body,
      status: "inbox",
      type: input.type,
      projectId: input.projectId,
      priority: input.priority,
      tags: input.tags,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectName: null,
    };
    this.created.push(record);
    if (key) {
      this.keyMap.set(`${actor.userId}:${key}`, record);
    }
    return ok(record);
  }
  async updateInboxItem() { return ok(null as any); }
  async setInboxItemStatus() { return ok(null as any); }
}

test("fast capture accepts raw thought without project/goal/priority (unstructured global)", async () => {
  const repo = new FakeRepo();
  const result = await createInboxItem(ACTOR, repo, { title: "  raw thought without project  " });
  assert.equal(result.ok, true);
  assert.equal((result as any).data.title, "raw thought without project");
  assert.equal((result as any).data.projectId, null);
  assert.equal((result as any).data.priority, null);
  assert.equal((result as any).data.status, "inbox");
});

test("fast capture accepts optional body/context without blocking quick submit", async () => {
  const repo = new FakeRepo();
  const result = await createInboxItem(ACTOR, repo, { title: "Idea", body: "  extra context  " });
  assert.equal(result.ok, true);
  assert.equal((result as any).data.body, "extra context");
});

test("fast capture lands in canonical inbox state", async () => {
  const repo = new FakeRepo();
  const result = await createInboxItem(ACTOR, repo, { title: "Inbox item" });
  assert.equal(result.ok, true);
  assert.equal((result as any).data.status, "inbox");
});

test("retry with same idempotency key does not create duplicate", async () => {
  const repo = new FakeRepo();
  const key = "test-key-123";
  const first = await createInboxItem(ACTOR, repo, { title: "Duplicate test", idempotencyKey: key });
  assert.equal(first.ok, true);
  const firstId = (first as any).data.id;
  const second = await createInboxItem(ACTOR, repo, { title: "Duplicate test", idempotencyKey: key });
  assert.equal(second.ok, true);
  assert.equal((second as any).data.id, firstId);
  assert.equal(repo.created.length, 1);
  assert.equal(repo.calls.filter((c) => c.method === "createInboxItem").length, 1);
  // second call should have hit getInboxItemByIdempotencyKey and not created second
  assert.equal(repo.calls.filter((c) => c.method === "getInboxItemByIdempotencyKey").length, 2);
});

test("different idempotency keys create distinct records", async () => {
  const repo = new FakeRepo();
  const a = await createInboxItem(ACTOR, repo, { title: "A", idempotencyKey: "key-a" });
  const b = await createInboxItem(ACTOR, repo, { title: "B", idempotencyKey: "key-b" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual((a as any).data.id, (b as any).data.id);
  assert.equal(repo.created.length, 2);
});

test("idempotency key too long is rejected", async () => {
  const repo = new FakeRepo();
  const longKey = "x".repeat(129);
  const result = await createInboxItem(ACTOR, repo, { title: "Idea", idempotencyKey: longKey });
  assert.equal(result.ok, false);
  assert.match((result as any).errorMessage, /too long/);
  assert.equal(repo.created.length, 0);
});

test("service preserves actor scoping for idempotency (cross-owner not shared)", async () => {
  const repo = new FakeRepo();
  const key = "shared-key";
  const actorA = createAuthenticatedActor("user-a");
  const actorB = createAuthenticatedActor("user-b");
  const first = await createInboxItem(actorA, repo, { title: "A idea", idempotencyKey: key });
  const second = await createInboxItem(actorB, repo, { title: "B idea", idempotencyKey: key });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual((first as any).data.id, (second as any).data.id);
});
