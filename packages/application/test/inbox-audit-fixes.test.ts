import assert from "node:assert/strict";
import test from "node:test";

import {
  computeInboxFingerprint,
  createInboxItem,
  deterministicInboxIdForCapture,
  createAuthenticatedActor,
  type AuthenticatedActor,
  type CreateInboxRecordInput,
  type InboxRecord,
  type InboxRepository,
  type RepositoryResult,
} from "../src/index";
import { sha256Hex } from "../src/shared/hash";

const ACTOR = createAuthenticatedActor("user-123");
const OTHER_ACTOR = createAuthenticatedActor("user-999");

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}
function conflict(): RepositoryResult<never> {
  return { ok: false, error: { code: "conflict" } };
}

class FakeInboxRepoForAudit implements InboxRepository {
  // simulate atomic PK via deterministic id map
  notes = new Map<string, InboxRecord>();
  keyEntries = new Map<string, { inboxItemId: string; fingerprint: string | null }>();
  ownerMap = new Map<string, string>(); // noteId -> owner

  async getScope(actor: AuthenticatedActor) {
    return ok({ projectIds: [] });
  }
  async listInboxItems() { return ok([] as InboxRecord[]); }
  async listProjectOptions() { return ok([] as any); }
  async getInboxItem(actor: AuthenticatedActor, id: string) {
    const note = this.notes.get(id);
    if (!note) return ok(null);
    // owner check
    if (this.ownerMap.get(id) !== actor.userId) return ok(null);
    return ok(note);
  }
  async getInboxItemByIdempotencyKey(actor: AuthenticatedActor, key: string) {
    const entry = this.keyEntries.get(`${actor.userId}:${key}`);
    if (!entry) return ok(null);
    return this.getInboxItem(actor, entry.inboxItemId);
  }
  async getInboxIdempotencyEntry(actor: AuthenticatedActor, key: string) {
    const entry = this.keyEntries.get(`${actor.userId}:${key}`);
    if (!entry) return ok(null);
    return ok({ inboxItemId: entry.inboxItemId, fingerprint: entry.fingerprint });
  }
  async createInboxItem(actor: AuthenticatedActor, input: CreateInboxRecordInput) {
    const key = (input as unknown as { idempotencyKey?: string }).idempotencyKey
      ? String((input as unknown as { idempotencyKey?: string }).idempotencyKey)
      : null;
    const fingerprint = (input as unknown as { fingerprint?: string }).fingerprint
      ? String((input as unknown as { fingerprint?: string }).fingerprint)
      : null;
    const id = (input as unknown as { id?: string }).id
      ? String((input as unknown as { id?: string }).id)
      : `rand-${Math.random()}`;

    // atomic PK check
    if (this.notes.has(id)) {
      // simulate 23505 -> conflict
      return conflict() as unknown as RepositoryResult<InboxRecord>;
    }
    // also check mapping duplicate (owner+key uniqueness)
    if (key && this.keyEntries.has(`${actor.userId}:${key}`)) {
      const existing = this.keyEntries.get(`${actor.userId}:${key}`)!;
      if (existing.fingerprint && fingerprint && existing.fingerprint !== fingerprint) {
        return conflict() as unknown as RepositoryResult<InboxRecord>;
      }
      // duplicate mapping -> treat as conflict for atomic replay
      // But we already have note; return conflict so service can replay
      // To simulate real race where second insert fails on PK, we already returned above
      // This path for second insert with different id but same key
      return conflict() as unknown as RepositoryResult<InboxRecord>;
    }
    const record: InboxRecord = {
      id,
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
    this.notes.set(id, record);
    this.ownerMap.set(id, actor.userId);
    if (key) {
      this.keyEntries.set(`${actor.userId}:${key}`, { inboxItemId: id, fingerprint });
    }
    return ok(record);
  }
  async updateInboxItem() { return ok(null as any); }
  async setInboxItemStatus() { return ok(null as any); }
  async getTaskIdForInboxItem() { return ok(null as string | null); }
  async createInboxTaskLink() { return ok(undefined); }
  async markInboxItemConverted() { return ok(null as any); }
}

// ---- C1: atomic concurrent capture ----
test("C1: concurrent same-key requests produce single note (deterministic id atomic)", async () => {
  const repo = new FakeInboxRepoForAudit();
  const key = "concurrent-key-c1";
  const [a, b] = await Promise.all([
    createInboxItem(ACTOR, repo, { title: "Concurrent", idempotencyKey: key }),
    createInboxItem(ACTOR, repo, { title: "Concurrent", idempotencyKey: key }),
  ]);
  // One should succeed, other should replay same record (no orphan)
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) {
    assert.equal(a.data.id, b.data.id, "concurrent same payload should resolve to same id");
  }
  // Only one note stored
  assert.equal(repo.notes.size, 1);
});

test("C1: concurrent same-key different payload should be conflict not silent replay", async () => {
  const repo = new FakeInboxRepoForAudit();
  const key = "conflict-key-c1";
  const first = await createInboxItem(ACTOR, repo, { title: "First", idempotencyKey: key });
  assert.equal(first.ok, true);
  const second = await createInboxItem(ACTOR, repo, { title: "Different payload", idempotencyKey: key });
  assert.equal(second.ok, false);
  assert.equal((second as unknown as { code?: string }).code, "conflict");
  assert.match((second as unknown as { errorMessage: string }).errorMessage, /conflict/i);
  assert.equal(repo.notes.size, 1, "no orphan for conflict payload");
});

test("deterministicInboxIdForCapture is stable owner-scoped", () => {
  const id1 = deterministicInboxIdForCapture(ACTOR, "key123");
  const id2 = deterministicInboxIdForCapture(ACTOR, "key123");
  const idOtherOwner = deterministicInboxIdForCapture(OTHER_ACTOR, "key123");
  assert.equal(id1, id2);
  assert.notEqual(id1, idOtherOwner);
  assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const expected = (() => {
    const h = sha256Hex(`${ACTOR.userId}:key123:inbox`);
    const hex = h.slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  })();
  assert.equal(id1, expected);
});

test("I3: same key same payload replay returns same record", async () => {
  const repo = new FakeInboxRepoForAudit();
  const key = "replay-same-payload";
  const first = await createInboxItem(ACTOR, repo, { title: "Hello", body: "body", tags: ["aa"], idempotencyKey: key });
  assert.equal(first.ok, true);
  const second = await createInboxItem(ACTOR, repo, { title: "Hello", body: "body", tags: ["aa"], idempotencyKey: key });
  assert.equal(second.ok, true);
  assert.equal((first as any).data.id, (second as any).data.id);
});

test("I3: same key different content returns conflict (fingerprint mismatch)", async () => {
  const repo = new FakeInboxRepoForAudit();
  const key = "fingerprint-conflict";
  const first = await createInboxItem(ACTOR, repo, { title: "A", body: "x", tags: ["z"], idempotencyKey: key });
  assert.equal(first.ok, true);
  // Different tags order should still be same (sorted) -> not conflict; test different title
  const second = await createInboxItem(ACTOR, repo, { title: "B", body: "x", tags: ["z"], idempotencyKey: key });
  assert.equal(second.ok, false);
  assert.equal((second as unknown as { code?: string }).code, "conflict");
});

test("I3: tags sorted fingerprint: different order same set => replay not conflict", async () => {
  const repo = new FakeInboxRepoForAudit();
  const key = "tags-order";
  const first = await createInboxItem(ACTOR, repo, { title: "t", tags: ["b", "a"], idempotencyKey: key });
  assert.equal(first.ok, true);
  const second = await createInboxItem(ACTOR, repo, { title: "t", tags: ["a", "b"], idempotencyKey: key });
  assert.equal(second.ok, true);
  assert.equal((first as any).data.id, (second as any).data.id);
});

test("I3: cross-owner same key independent (fingerprint per owner)", async () => {
  const repo = new FakeInboxRepoForAudit();
  const key = "shared-key-cross";
  const a = await createInboxItem(ACTOR, repo, { title: "Owner A", idempotencyKey: key });
  const b = await createInboxItem(OTHER_ACTOR, repo, { title: "Owner B", idempotencyKey: key });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual((a as any).data.id, (b as any).data.id);
  assert.equal(repo.notes.size, 2);
});

test("computeInboxFingerprint deterministic and normalized", () => {
  const fp1 = computeInboxFingerprint({ title: " Hello ", body: "  body ", projectId: null, tags: ["b", "a"], type: "idea" });
  const fp2 = computeInboxFingerprint({ title: "Hello", body: "body", projectId: null, tags: ["a", "b"], type: "idea" });
  assert.equal(fp1, fp2, "whitespace and tag order normalized");
  const fp3 = computeInboxFingerprint({ title: "Hello", body: "body", projectId: "111", tags: ["a"], type: "idea" });
  assert.notEqual(fp1, fp3);
});
