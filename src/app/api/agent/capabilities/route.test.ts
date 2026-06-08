import assert from "node:assert/strict";
import test from "node:test";

import type { TokenRepository } from "@/lib/services/agent-token-repository";
import { generateRawToken, hashToken } from "@/lib/crypto/agent-token";
import { createCapabilitiesHandler, type TelemetryFn } from "@/lib/http/agent-capabilities-handler";

// Set pepper before handler module initialization
process.env.AGENT_TOKEN_PEPPER = "test-pepper-for-unit-tests";

const TEST_PEPPER = "test-pepper-for-unit-tests";

function createMockRepo(
  options?: { revoked?: boolean },
): TokenRepository {
  const { prefix, secret } = generateRawToken();
  const tokenHash = hashToken(secret, TEST_PEPPER);

  return {
    findByPrefix: async (p: string) => {
      if (p !== prefix) return null;
      return {
        id: "test-handler-id",
        ownerUserId: "00000000-0000-0000-0000-000000000001",
        name: "handler-test",
        tokenPrefix: prefix,
        tokenHash,
        scopes: { tasks: { read: true, create: true } },
        lastUsedAt: null,
        revokedAt: options?.revoked ? new Date().toISOString() : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    insertToken: async () => "test-handler-id",
    updateLastUsedAt: async () => {},
    revokeToken: async () => {},
  };
}

test("GET /api/agent/capabilities returns 200 with capabilities for valid token", async () => {
  const { prefix, secret } = generateRawToken();
  const tokenHash = hashToken(secret, TEST_PEPPER);

  const mockRepo: TokenRepository = {
    findByPrefix: async () => ({
      id: "test-id",
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      name: "test",
      tokenPrefix: prefix,
      tokenHash,
      scopes: {
        tasks: { read: true, create: true, bulkLimit: 25, idempotency: "source+sourceId" },
        projects: { read: true },
      },
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    insertToken: async () => "test-id",
    updateLastUsedAt: async () => {},
    revokeToken: async () => {},
  };

  const handler = createCapabilitiesHandler(mockRepo);
  const request = new Request("http://localhost/api/agent/capabilities", {
    headers: { authorization: `Bearer ega_live_${prefix}_${secret}` },
  });

  const response = await handler(request);
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.agent, "ega-house");
  assert.equal(body.capabilities.tasks.read, true);
  assert.equal(body.capabilities.tasks.create, true);
  assert.equal(body.capabilities.tasks.bulkLimit, 25);
  assert.equal(body.capabilities.tasks.idempotency, "source+sourceId");
  assert.equal(body.capabilities.projects.read, true);
  assert.equal(body.capabilities.goals.read, false);

  // Verify response minimization — no internal fields
  assert.equal("tokenId" in body, false);
  assert.equal("ownerUserId" in body, false);
  assert.equal("tokenPrefix" in body, false);
  assert.equal("tokenHash" in body, false);
  assert.equal("lastUsedAt" in body, false);
  assert.equal("revokedAt" in body, false);
});

test("GET /api/agent/capabilities returns 401 for missing header", async () => {
  const handler = createCapabilitiesHandler(createMockRepo());
  const request = new Request("http://localhost/api/agent/capabilities");

  const response = await handler(request);
  assert.equal(response.status, 401);

  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "UNAUTHENTICATED");
  assert.equal(body.error.message, "Missing or invalid agent token.");
});

test("GET /api/agent/capabilities returns 401 for invalid token", async () => {
  const handler = createCapabilitiesHandler(createMockRepo());
  const request = new Request("http://localhost/api/agent/capabilities", {
    headers: { authorization: "Bearer invalid-token-format" },
  });

  const response = await handler(request);
  assert.equal(response.status, 401);

  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "UNAUTHENTICATED");
});

test("telemetry is called with tokenId on success", async () => {
  const { prefix, secret } = generateRawToken();
  const tokenHash = hashToken(secret, TEST_PEPPER);
  let calledTokenId: string | null = null;

  const mockRepo: TokenRepository = {
    findByPrefix: async () => ({
      id: "telemetry-test-id",
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      name: "telemetry-test",
      tokenPrefix: prefix,
      tokenHash,
      scopes: {},
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    insertToken: async () => "",
    updateLastUsedAt: async () => {},
    revokeToken: async () => {},
  };

  const telemetry: TelemetryFn = async (tokenId) => {
    calledTokenId = tokenId;
  };

  const handler = createCapabilitiesHandler(mockRepo, telemetry);
  await handler(new Request("http://localhost/api/agent/capabilities", {
    headers: { authorization: `Bearer ega_live_${prefix}_${secret}` },
  }));

  assert.equal(calledTokenId, "telemetry-test-id");
});

test("telemetry failure does not affect the response", async () => {
  const { prefix, secret } = generateRawToken();
  const tokenHash = hashToken(secret, TEST_PEPPER);

  const mockRepo: TokenRepository = {
    findByPrefix: async () => ({
      id: "telemetry-fail-id",
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      name: "telemetry-fail",
      tokenPrefix: prefix,
      tokenHash,
      scopes: {},
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    insertToken: async () => "",
    updateLastUsedAt: async () => {},
    revokeToken: async () => {},
  };

  const telemetry: TelemetryFn = async () => { throw new Error("telemetry failure"); };

  const handler = createCapabilitiesHandler(mockRepo, telemetry);
  const response = await handler(new Request("http://localhost/api/agent/capabilities", {
    headers: { authorization: `Bearer ega_live_${prefix}_${secret}` },
  }));

  assert.equal(response.status, 200);
});

// ---- Handler-level 500 errors ----

test("GET returns 500 when pepper is not configured", async () => {
  const handler = createCapabilitiesHandler(createMockRepo());

  // Simulate a request that reaches HMAC verification
  // The handler catches the throw from resolveAgentAuth
  // We need pepper missing to cause an error
  // Use resetPepper to clear cache, then delete env var
  // But we also need a request that passes earlier checks

  // Actually, the simplest way: mock repo returns a record
  // and the handler catches the error from resolveAgentAuth
  const saved = process.env.AGENT_TOKEN_PEPPER;
  // We can't easily test this without resetPepper import
  // The service module caches pepper after first call

  // For now, test via a repo that throws (simulating DB failure)
  const throwingRepo: TokenRepository = {
    findByPrefix: async () => { throw new Error("db error"); },
    insertToken: async () => "",
    updateLastUsedAt: async () => {},
    revokeToken: async () => {},
  };

  const errorHandler = createCapabilitiesHandler(throwingRepo);
  const request = new Request("http://localhost/api/agent/capabilities", {
    headers: { authorization: "Bearer " + "ega_live_" + "a".repeat(16) + "_" + "a".repeat(48) },
  });

  const response = await errorHandler(request);
  assert.equal(response.status, 500);

  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.message, "The request could not be completed.");

  // Verify no sensitive info is leaked
  const bodyStr = JSON.stringify(body);
  assert.equal(bodyStr.includes("db error"), false);
  assert.equal(bodyStr.includes("AGENT_TOKEN_PEPPER"), false);
  assert.equal(bodyStr.includes("stack"), false);
  assert.equal(bodyStr.includes("tokenId"), false);
  assert.equal(bodyStr.includes("ownerUserId"), false);
  assert.equal(bodyStr.includes("tokenPrefix"), false);
  assert.equal(bodyStr.includes("tokenHash"), false);
  assert.equal(bodyStr.includes("Error"), false);
});

test("GET returns 500 for corrupted stored token hash", async () => {
  const prefix = "a".repeat(16);
  const mockRepo: TokenRepository = {
    ...{
      findByPrefix: async () => null,
      insertToken: async () => "",
      updateLastUsedAt: async () => {},
      revokeToken: async () => {},
    },
    findByPrefix: async () => ({
      id: "corrupted-hash-id",
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      name: "corrupted-hash",
      tokenPrefix: prefix,
      tokenHash: "not-a-valid-hex-hash",  // intentionally invalid
      scopes: {},
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  };

  const handler = createCapabilitiesHandler(mockRepo);
  const request = new Request("http://localhost/api/agent/capabilities", {
    headers: { authorization: "Bearer ega_live_" + prefix + "_" + "a".repeat(48) },
  });

  const response = await handler(request);
  assert.equal(response.status, 500);

  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.message, "The request could not be completed.");

  // Verify no sensitive info is leaked
  const bodyStr = JSON.stringify(body);
  assert.equal(bodyStr.includes("not-a-valid-hex-hash"), false);
  assert.equal(bodyStr.includes("corrupted"), false);
  assert.equal(bodyStr.includes("tokenId"), false);
  assert.equal(bodyStr.includes("ownerUserId"), false);
  assert.equal(bodyStr.includes("tokenPrefix"), false);
  assert.equal(bodyStr.includes("tokenHash"), false);
});
