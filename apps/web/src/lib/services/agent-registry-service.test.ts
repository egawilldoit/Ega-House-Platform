import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { NewTokenRecord, TokenRecord } from "@/lib/contracts/agent";
import { generateRawToken, hashToken } from "@/lib/crypto/agent-token";
import {
  issueAgentCredential,
  revokeAgentCredential,
  setAgentActorArchived,
  type AgentCredentialStore,
} from "./agent-registry-service";
import { resetPepper, resolveAgentAuth } from "./agent-token-service";

const PEPPER = "test-pepper-for-agent-registry";
process.env.AGENT_TOKEN_PEPPER = PEPPER;

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

class MemoryCredentialStore implements AgentCredentialStore {
  records: TokenRecord[] = [];

  async listByOwner(ownerUserId: string): Promise<TokenRecord[]> {
    return this.records.filter((record) => record.ownerUserId === ownerUserId);
  }

  async findByIdForOwner(id: string, ownerUserId: string): Promise<TokenRecord | null> {
    return (
      this.records.find(
        (record) => record.id === id && record.ownerUserId === ownerUserId,
      ) ?? null
    );
  }

  async revokeToken(id: string): Promise<void> {
    const record = this.records.find((candidate) => candidate.id === id);
    if (record) record.revokedAt = new Date().toISOString();
  }

  async revokeActiveForAgent(agentId: string, ownerUserId: string): Promise<number> {
    let count = 0;
    for (const record of this.records) {
      if (
        record.agentId === agentId &&
        record.ownerUserId === ownerUserId &&
        record.revokedAt === null
      ) {
        record.revokedAt = new Date().toISOString();
        count += 1;
      }
    }
    return count;
  }

  async insertToken(record: NewTokenRecord): Promise<string> {
    const id = randomUUID();
    this.records.push({
      ...record,
      id,
      agentId: record.agentId ?? null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return id;
  }

  async findByPrefix(prefix: string): Promise<TokenRecord | null> {
    return this.records.find((record) => record.tokenPrefix === prefix) ?? null;
  }

  async updateLastUsedAt(): Promise<void> {}
}

function fakeClient(userId: string, actor: { id: string; archived_at: string | null } | null) {
  type Chain = {
    select: () => Chain;
    insert: () => Chain;
    update: () => Chain;
    eq: () => Chain;
    order: () => Chain;
    limit: () => Chain;
    maybeSingle: () => Promise<{ data: typeof actor; error: null }>;
    single: () => Promise<{ data: typeof actor; error: null }>;
  };
  const result = {
    data: actor && actor.id ? actor : null,
    error: null as null,
  };
  const chain = {} as Chain;
  chain.select = () => chain;
  chain.insert = () => chain;
  chain.update = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = async () => result;
  chain.single = async () => result;
  return {
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: () => chain,
  };
}

function tokenFixture(agentId: string | null, owner = OWNER) {
  const { prefix, secret } = generateRawToken();
  return {
    prefix,
    raw: `ega_live_${prefix}_${secret}`,
    record: {
      id: randomUUID(),
      ownerUserId: owner,
      agentId,
      name: "fixture",
      tokenPrefix: prefix,
      tokenHash: hashToken(secret, PEPPER),
      scopes: { tasks: { read: true } },
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies TokenRecord,
  };
}

function authRequest(raw: string): Request {
  return new Request("http://localhost/api/agent/tasks", {
    headers: { authorization: `Bearer ${raw}` },
  });
}

test("revoking one credential blocks it immediately and leaves the agent's other credential active", async () => {
  resetPepper();
  const store = new MemoryCredentialStore();
  const first = tokenFixture(AGENT_A);
  const second = tokenFixture(AGENT_A);
  store.records.push(first.record, second.record);

  const before = await resolveAgentAuth(authRequest(first.raw), store);
  assert.equal(before.ok, true);

  const revoked = await revokeAgentCredential(first.record.id, {
    client: fakeClient(OWNER, null) as never,
    credentials: store,
  });
  assert.equal(revoked.ok, true);

  const after = await resolveAgentAuth(authRequest(first.raw), store);
  assert.equal(after.ok, false);
  if (!after.ok) assert.equal(after.status, 401);

  const stillActive = await resolveAgentAuth(authRequest(second.raw), store);
  assert.equal(stillActive.ok, true);
  if (stillActive.ok) assert.equal(stillActive.context.agentId, AGENT_A);
});

test("revocation is owner-scoped and cannot target another owner's credential", async () => {
  resetPepper();
  const store = new MemoryCredentialStore();
  const other = tokenFixture(AGENT_A, OTHER_OWNER);
  store.records.push(other.record);

  const result = await revokeAgentCredential(other.record.id, {
    client: fakeClient(OWNER, null) as never,
    credentials: store,
  });
  assert.equal(result.ok, false);
  assert.equal(store.records[0]?.revokedAt, null);
});

test("issuing a credential binds it to the configured identity", async () => {
  resetPepper();
  const store = new MemoryCredentialStore();
  const result = await issueAgentCredential(
    {
      agentId: AGENT_A,
      name: "Local workspace",
      scopes: { tasks: { read: true } },
    },
    {
      client: fakeClient(OWNER, { id: AGENT_A, archived_at: null }) as never,
      credentials: store,
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(store.records.length, 1);
  assert.equal(store.records[0]?.agentId, AGENT_A);
  assert.equal(store.records[0]?.ownerUserId, OWNER);

  const auth = await resolveAgentAuth(authRequest(result.token), store);
  assert.equal(auth.ok, true);
  if (auth.ok) {
    assert.equal(auth.context.agentId, AGENT_A);
    assert.equal(auth.context.ownerUserId, OWNER);
  }
});

test("an archived agent cannot issue new credentials", async () => {
  resetPepper();
  const store = new MemoryCredentialStore();
  const result = await issueAgentCredential(
    {
      agentId: AGENT_A,
      name: "Local workspace",
      scopes: { tasks: { read: true } },
    },
    {
      client: fakeClient(OWNER, {
        id: AGENT_A,
        archived_at: new Date().toISOString(),
      }) as never,
      credentials: store,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(store.records.length, 0);
});

test("archiving an agent revokes only that agent's active credentials", async () => {
  resetPepper();
  const store = new MemoryCredentialStore();
  const first = tokenFixture(AGENT_A);
  const second = tokenFixture(AGENT_A);
  const otherAgent = tokenFixture(AGENT_B);
  store.records.push(first.record, second.record, otherAgent.record);

  const result = await setAgentActorArchived(AGENT_A, true, {
    client: fakeClient(OWNER, { id: AGENT_A, archived_at: null }) as never,
    credentials: store,
  });

  assert.equal(result.ok, true);
  assert.equal(result.revokedCredentials, 2);
  assert.notEqual(store.records[0]?.revokedAt, null);
  assert.notEqual(store.records[1]?.revokedAt, null);
  assert.equal(store.records[2]?.revokedAt, null);
});
