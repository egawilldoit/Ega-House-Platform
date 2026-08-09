import assert from "node:assert/strict";
import test from "node:test";

import type { TokenRepository } from "@/lib/services/agent-token-repository";
import {
  resolveAgentAuth,
  getCapabilities,
  generateAgentToken,
  resetPepper,
} from "@/lib/services/agent-token-service";
import { generateRawToken, hashToken } from "@/lib/crypto/agent-token";
import type { AgentTokenScopes } from "@/lib/contracts/agent";

// ---- Setup ----

const TEST_PEPPER = "test-pepper-for-unit-tests";
process.env.AGENT_TOKEN_PEPPER = TEST_PEPPER;

function createRequest(authHeader: string | null): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== null) {
    headers.authorization = authHeader;
  }
  return new Request("http://localhost/api/agent/capabilities", { headers });
}

const EMPTY_MOCK_REPO: TokenRepository = {
  findByPrefix: async () => null,
  insertToken: async () => "",
  updateLastUsedAt: async () => {},
  revokeToken: async () => {},
};

// ---- resolveAgentAuth: success path ----

test("resolveAgentAuth: valid token returns context", async () => {
  const { prefix, secret } = generateRawToken();
  const tokenHash = hashToken(secret, TEST_PEPPER);

  const mockRepo: TokenRepository = {
    ...EMPTY_MOCK_REPO,
    findByPrefix: async () => ({
      id: "test-id",
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      name: "test",
      tokenPrefix: prefix,
      tokenHash,
      scopes: { tasks: { read: true } },
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  };

  const result = await resolveAgentAuth(
    createRequest("Bearer ega_live_" + prefix + "_" + secret),
    mockRepo,
  );

  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.context.tokenId, "test-id");
    assert.equal(
      result.context.ownerUserId,
      "00000000-0000-0000-0000-000000000001",
    );
    assert.equal(result.context.scopes.tasks?.read, true);
  }
});

// ---- resolveAgentAuth: all 5 failure modes return identical 401 ----

const UNAUTHENTICATED_MESSAGE = "Missing or invalid agent token.";

async function assertUnauthenticated(
  request: Request,
  repo: TokenRepository,
): Promise<void> {
  const result = await resolveAgentAuth(request, repo);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 401);
    assert.equal(result.response.error.code, "UNAUTHENTICATED");
    assert.equal(result.response.error.message, UNAUTHENTICATED_MESSAGE);
  }
}

test("resolveAgentAuth returns 401 for missing Authorization header", async () => {
  await assertUnauthenticated(createRequest(null), EMPTY_MOCK_REPO);
});

test("resolveAgentAuth returns 401 for malformed token", async () => {
  await assertUnauthenticated(
    createRequest("Bearer bad-token-format"),
    EMPTY_MOCK_REPO,
  );
});

test("resolveAgentAuth returns 401 for unknown prefix", async () => {
  const { prefix, secret } = generateRawToken();
  await assertUnauthenticated(
    createRequest("Bearer ega_live_" + prefix + "_" + secret),
    EMPTY_MOCK_REPO,
  );
});

test("resolveAgentAuth returns 401 for revoked token", async () => {
  const { prefix, secret } = generateRawToken();
  const tokenHash = hashToken(secret, TEST_PEPPER);

  const mockRepo: TokenRepository = {
    ...EMPTY_MOCK_REPO,
    findByPrefix: async () => ({
      id: "revoked-id",
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      name: "revoked",
      tokenPrefix: prefix,
      tokenHash,
      scopes: { tasks: { read: true } },
      lastUsedAt: null,
      revokedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  };

  await assertUnauthenticated(
    createRequest("Bearer ega_live_" + prefix + "_" + secret),
    mockRepo,
  );
});

test("resolveAgentAuth returns 401 for wrong secret", async () => {
  const { prefix } = generateRawToken();
  const correctSecret = "b".repeat(48);
  const tokenHash = hashToken(correctSecret, TEST_PEPPER);

  const mockRepo: TokenRepository = {
    ...EMPTY_MOCK_REPO,
    findByPrefix: async () => ({
      id: "wrong-secret-id",
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      name: "wrong-secret",
      tokenPrefix: prefix,
      tokenHash,
      scopes: { tasks: { read: true } },
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  };

  await assertUnauthenticated(
    createRequest("Bearer ega_live_" + prefix + "_" + "a".repeat(48)),
    mockRepo,
  );
});

// ---- resolveAgentAuth: configuration/database errors THROW (to 500) ----

test("resolveAgentAuth throws when pepper is missing", async () => {
  resetPepper();
  const saved = process.env.AGENT_TOKEN_PEPPER;
  delete process.env.AGENT_TOKEN_PEPPER;

  const validPrefix = "a".repeat(16);
  const mockRepo: TokenRepository = {
    ...EMPTY_MOCK_REPO,
    findByPrefix: async () => ({
      id: "pepper-test-id",
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      name: "pepper-test",
      tokenPrefix: validPrefix,
      tokenHash: "a".repeat(64),
      scopes: {},
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  };

  try {
    await assert.rejects(
      () =>
        resolveAgentAuth(
          createRequest("Bearer ega_live_" + validPrefix + "_" + "a".repeat(48)),
          mockRepo,
        ),
      /AGENT_TOKEN_PEPPER is not configured/,
    );
  } finally {
    process.env.AGENT_TOKEN_PEPPER=saved;
  }
});

test("resolveAgentAuth propagates repo.findByPrefix errors", async () => {
  const throwingRepo: TokenRepository = {
    ...EMPTY_MOCK_REPO,
    findByPrefix: async () => {
      throw new Error("Database connection failed");
    },
  };

  await assert.rejects(
    () =>
      resolveAgentAuth(
        createRequest("Bearer ega_live_" + "a".repeat(16) + "_" + "a".repeat(48)),
        throwingRepo,
      ),
    /Database connection failed/,
  );
});

test("resolveAgentAuth does not throw for telemetry errors", async () => {
  const { prefix, secret } = generateRawToken();
  const tokenHash = hashToken(secret, TEST_PEPPER);

  const throwingRepo: TokenRepository = {
    ...EMPTY_MOCK_REPO,
    findByPrefix: async () => ({
      id: "telemetry-error-id",
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      name: "telemetry-error",
      tokenPrefix: prefix,
      tokenHash,
      scopes: {},
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    updateLastUsedAt: async () => {
      throw new Error("Telemetry write failed");
    },
  };

  const result = await resolveAgentAuth(
    createRequest("Bearer ega_live_" + prefix + "_" + secret),
    throwingRepo,
  );
  assert.ok(result.ok);
});

// ---- generateAgentToken ----

test("generateAgentToken succeeds and returns raw token", async () => {
  const inserted: Array<Record<string, unknown>> = [];

  const capturingRepo: TokenRepository = {
    ...EMPTY_MOCK_REPO,
    insertToken: async (record) => {
      inserted.push(record);
      return "generated-id";
    },
  };

  const rawToken = await generateAgentToken(
    "00000000-0000-0000-0000-000000000001",
    "test-token",
    { tasks: { read: true } },
    capturingRepo,
  );

  assert.ok(rawToken.startsWith("ega_live_"));
  assert.equal(rawToken.split("_").length, 4);

  assert.equal(inserted.length, 1);
  const stored = inserted[0] as Record<string, unknown>;
  assert.equal(typeof stored.tokenPrefix, "string");
  assert.equal(typeof stored.tokenHash, "string");
  assert.equal((stored.tokenPrefix as string).length, 16);
  assert.equal((stored.tokenHash as string).length, 64);
  assert.equal("token" in stored, false);
  assert.equal("secret" in stored, false);
  assert.equal("raw" in stored, false);
});

test("generateAgentToken retries on prefix collision", async () => {
  let callCount = 0;

  const collidingRepo: TokenRepository = {
    ...EMPTY_MOCK_REPO,
    insertToken: async () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error("duplicate key") as Error & { code?: string; constraint?: string };
        err.code = "23505";
        err.constraint = "agent_token_prefix_unique";
        throw err;
      }
      return "collision-retry-id";
    },
  };

  const rawToken = await generateAgentToken(
    "00000000-0000-0000-0000-000000000001",
    "collision-test",
    { tasks: { read: true } },
    collidingRepo,
  );

  assert.equal(callCount, 2);
  assert.ok(rawToken.startsWith("ega_live_"));
});

test("generateAgentToken throws after exhaustion", async () => {
  const exhaustedRepo: TokenRepository = {
    ...EMPTY_MOCK_REPO,
    insertToken: async () => {
      const err = new Error("duplicate key") as Error & { code?: string; constraint?: string };
      err.code = "23505";
      err.constraint = "agent_token_prefix_unique";
      throw err;
    },
  };

  await assert.rejects(
    () => generateAgentToken(
      "00000000-0000-0000-0000-000000000001",
      "exhaust-test",
      { tasks: { read: true } },
      exhaustedRepo,
    ),
    /Failed to generate unique token prefix/,
  );
});

test("generateAgentToken propagates non-23505 errors immediately", async () => {
  const errorRepo: TokenRepository = {
    ...EMPTY_MOCK_REPO,
    insertToken: async () => {
      throw new Error("Disk full");
    },
  };

  await assert.rejects(
    () => generateAgentToken(
      "00000000-0000-0000-0000-000000000001",
      "error-test",
      { tasks: { read: true } },
      errorRepo,
    ),
    /Disk full/,
  );
});

test("generateAgentToken does not retry unrelated 23505 errors", async () => {
  let callCount = 0;

  const unrelatedRepo: TokenRepository = {
    ...EMPTY_MOCK_REPO,
    insertToken: async () => {
      callCount++;
      const err = new Error("duplicate key") as Error & { code?: string; constraint?: string };
      err.code = "23505";
      err.constraint = "some_other_unique_index";
      throw err;
    },
  };

  await assert.rejects(() =>
    generateAgentToken(
      "00000000-0000-0000-0000-000000000001",
      "unrelated-test",
      { tasks: { read: true } },
      unrelatedRepo,
    ),
  );

  assert.equal(callCount, 1);
});

test("generateAgentToken retries 23505 without constraint name (legacy)", async () => {
  let callCount = 0;

  const noConstraintRepo: TokenRepository = {
    ...EMPTY_MOCK_REPO,
    insertToken: async () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error("duplicate key") as Error & { code?: string; constraint?: string };
        err.code = "23505";
        throw err;
      }
      return "legacy-retry-id";
    },
  };

  const rawToken = await generateAgentToken(
    "00000000-0000-0000-0000-000000000001",
    "legacy-test",
    { tasks: { read: true } },
    noConstraintRepo,
  );

  assert.equal(callCount, 2);
  assert.ok(rawToken.startsWith("ega_live_"));
});

// ---- getCapabilities ----

test("getCapabilities returns all false for empty scopes", () => {
  const caps = getCapabilities({});
  assert.equal(caps.tasks.read, false);
  assert.equal(caps.tasks.create, false);
  assert.equal(caps.tasks.updateAny, false);
  assert.equal(caps.tasks.archive, false);
  assert.equal(caps.tasks.bulk, false);
  assert.equal(caps.projects.read, false);
  assert.equal(caps.goals.read, false);
});

test("getCapabilities returns true for enabled scopes", () => {
  const scopes: AgentTokenScopes = {
    tasks: { read: true, create: true, updateAny: true, archive: true, bulk: true },
    projects: { read: true },
    goals: { read: true },
  };
  const caps = getCapabilities(scopes);
  assert.equal(caps.tasks.read, true);
  assert.equal(caps.tasks.create, true);
  assert.equal(caps.tasks.updateAny, true);
  assert.equal(caps.tasks.archive, true);
  assert.equal(caps.tasks.bulk, true);
  assert.equal(caps.projects.read, true);
  assert.equal(caps.goals.read, true);
});

test("getCapabilities includes bulkLimit and idempotency when present", () => {
  const scopes: AgentTokenScopes = {
    tasks: { read: true, bulkLimit: 25, idempotency: "source+sourceId" },
  };
  const caps = getCapabilities(scopes);
  assert.equal(caps.tasks.bulkLimit, 25);
  assert.equal(caps.tasks.idempotency, "source+sourceId");
});

test("getCapabilities omits bulkLimit and idempotency when absent", () => {
  const caps = getCapabilities({ tasks: { read: true } });
  assert.equal("bulkLimit" in caps.tasks, false);
  assert.equal("idempotency" in caps.tasks, false);
});
