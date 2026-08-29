import { describe, expect, it } from "vitest";
import { createRequestStateCodec, getRequestStateSecret, McpRequestStateConfigurationError } from "@/lib/mcp/request-state";
import { assertVerifiedMcpMutationState, McpMutationStateError, mintMcpMutationState } from "@/lib/mcp/mrtr-binding";
import type { McpMutationBinding, McpMutationCurrent } from "@/lib/mcp/mrtr-binding";

const TEST_SECRET = "test-secret-32-bytes-long-for-dev-only-1234";
const STABLE_CONFIG_MESSAGE = "MCP_REQUEST_STATE_SECRET must be configured with at least 32 bytes of entropy.";

function createTestCodec() {
  return createRequestStateCodec<McpMutationBinding>({ key: TEST_SECRET, ttlSeconds: 300 });
}

function createBinding(): McpMutationBinding {
  return {
    user: "00000000-0000-0000-0000-000000000001",
    client: "hermes-client",
    grantId: "10000000-0000-0000-0000-000000000001",
    grantVersion: 3,
    resource: "https://ega.example.com/api/mcp",
    tool: "ega_clear_completed_today",
    operationId: "op-1",
    argsHash: "hash-1",
    phase: "awaiting_confirmation",
    targetDate: "2026-08-28",
  };
}

function createCurrent(): McpMutationCurrent {
  return {
    principal: {
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      oauthClientId: "hermes-client",
      grantId: "10000000-0000-0000-0000-000000000001",
      permissionsVersion: 3,
    },
    resource: "https://ega.example.com/api/mcp",
    tool: "ega_clear_completed_today",
    operationId: "op-1",
    argsHash: "hash-1",
    expectedPhase: "awaiting_confirmation",
    targetDate: "2026-08-28",
  };
}

function expectStateMismatch(current: McpMutationCurrent, verifiedState: unknown, field: string): void {
  let caught: unknown;
  try {
    assertVerifiedMcpMutationState(current, verifiedState);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(McpMutationStateError);
  const stateError = caught as McpMutationStateError;
  expect(stateError.code).toBe("STATE_MISMATCH");
  expect(stateError.message).toContain(`"${field}"`);
  expect(stateError.message).not.toContain(TEST_SECRET);
}

describe("mrtr binding verified-state assertion", () => {
  it("accepts a verified state that matches the current request", async () => {
    const codec = createTestCodec();
    const token = await mintMcpMutationState(codec, createBinding());
    const verified = await codec.verify(token);
    expect(() => assertVerifiedMcpMutationState(createCurrent(), verified)).not.toThrow();
  });

  it("rejects a wrong user", async () => {
    const codec = createTestCodec();
    const verified = await codec.verify(await mintMcpMutationState(codec, createBinding()));
    const current = createCurrent();
    current.principal.ownerUserId = "00000000-0000-0000-0000-000000000099";
    expectStateMismatch(current, verified, "user");
  });

  it("rejects a wrong client", async () => {
    const codec = createTestCodec();
    const verified = await codec.verify(await mintMcpMutationState(codec, createBinding()));
    const current = createCurrent();
    current.principal.oauthClientId = "attacker-client";
    expectStateMismatch(current, verified, "client");
  });

  it("rejects a wrong grantId", async () => {
    const codec = createTestCodec();
    const verified = await codec.verify(await mintMcpMutationState(codec, createBinding()));
    const current = createCurrent();
    current.principal.grantId = "20000000-0000-0000-0000-000000000002";
    expectStateMismatch(current, verified, "grantId");
  });

  it("rejects a wrong grantVersion", async () => {
    const codec = createTestCodec();
    const verified = await codec.verify(await mintMcpMutationState(codec, createBinding()));
    const current = createCurrent();
    current.principal.permissionsVersion = 999;
    expectStateMismatch(current, verified, "grantVersion");
  });

  it("rejects a wrong resource", async () => {
    const codec = createTestCodec();
    const verified = await codec.verify(await mintMcpMutationState(codec, createBinding()));
    const current = createCurrent();
    current.resource = "https://evil.example.com/api/mcp";
    expectStateMismatch(current, verified, "resource");
  });

  it("rejects a wrong tool", async () => {
    const codec = createTestCodec();
    const verified = await codec.verify(await mintMcpMutationState(codec, createBinding()));
    const current = createCurrent();
    current.tool = "ega_delete_everything";
    expectStateMismatch(current, verified, "tool");
  });

  it("rejects a wrong operationId", async () => {
    const codec = createTestCodec();
    const verified = await codec.verify(await mintMcpMutationState(codec, createBinding()));
    const current = createCurrent();
    current.operationId = "op-2";
    expectStateMismatch(current, verified, "operationId");
  });

  it("rejects a wrong argsHash", async () => {
    const codec = createTestCodec();
    const verified = await codec.verify(await mintMcpMutationState(codec, createBinding()));
    const current = createCurrent();
    current.argsHash = "hash-2";
    expectStateMismatch(current, verified, "argsHash");
  });

  it("rejects a wrong phase", async () => {
    const codec = createTestCodec();
    const verified = await codec.verify(await mintMcpMutationState(codec, createBinding()));
    const current = createCurrent();
    current.expectedPhase = "executed";
    expectStateMismatch(current, verified, "phase");
  });

  it("rejects a wrong optional targetDate when expected", async () => {
    const codec = createTestCodec();
    const verified = await codec.verify(await mintMcpMutationState(codec, createBinding()));
    const current = createCurrent();
    current.targetDate = "2026-09-01";
    expectStateMismatch(current, verified, "targetDate");
  });

  it("rejects a wrong optional targetId when expected", async () => {
    const codec = createTestCodec();
    const binding = createBinding();
    binding.targetId = "task-1";
    const verified = await codec.verify(await mintMcpMutationState(codec, binding));
    const current = createCurrent();
    current.targetId = "task-2";
    expectStateMismatch(current, verified, "targetId");
  });

  it("does not compare optional fields when they are not expected", async () => {
    const codec = createTestCodec();
    const binding = createBinding();
    delete binding.targetDate;
    const verified = await codec.verify(await mintMcpMutationState(codec, binding));
    const current = createCurrent();
    delete current.targetDate;
    expect(() => assertVerifiedMcpMutationState(current, verified)).not.toThrow();
  });

  it("rejects missing verified state", async () => {
    const codec = createTestCodec();
    for (const missing of [undefined, null]) {
      let caught: unknown;
      try {
        assertVerifiedMcpMutationState(createCurrent(), missing);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(McpMutationStateError);
      expect((caught as McpMutationStateError).code).toBe("STATE_MISSING");
    }
    await expect(codec.verify("")).rejects.toThrow();
  });

  it("rejects a tampered token signature at codec.verify", async () => {
    const codec = createTestCodec();
    const token = await mintMcpMutationState(codec, createBinding());
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    await expect(codec.verify(tampered)).rejects.toThrowError("Invalid requestState signature.");
  });
});

describe("getRequestStateSecret", () => {
  it("throws with the stable message when the env secret is missing", () => {
    expect(() => getRequestStateSecret({})).toThrowError(McpRequestStateConfigurationError);
    expect(() => getRequestStateSecret({})).toThrowError(STABLE_CONFIG_MESSAGE);
    expect(() => getRequestStateSecret({ MCP_REQUEST_STATE_SECRET: "" })).toThrowError(STABLE_CONFIG_MESSAGE);
    expect(() => getRequestStateSecret({ MCP_REQUEST_STATE_SECRET: "   " })).toThrowError(STABLE_CONFIG_MESSAGE);
  });

  it("has no default fallback secret", () => {
    const original = process.env.MCP_REQUEST_STATE_SECRET;
    delete process.env.MCP_REQUEST_STATE_SECRET;
    try {
      expect(() => getRequestStateSecret()).toThrowError(STABLE_CONFIG_MESSAGE);
    } finally {
      if (original !== undefined) process.env.MCP_REQUEST_STATE_SECRET = original;
    }
  });

  it("throws when decoded entropy is below 32 bytes", () => {
    expect(() => getRequestStateSecret({ MCP_REQUEST_STATE_SECRET: "short" })).toThrowError(STABLE_CONFIG_MESSAGE);
    expect(() => getRequestStateSecret({ MCP_REQUEST_STATE_SECRET: "0123456789abcdef0123456789abcde" })).toThrowError(STABLE_CONFIG_MESSAGE);
  });

  it("accepts a 32+ byte hex secret", () => {
    const hex = "aa".repeat(32);
    const secret = getRequestStateSecret({ MCP_REQUEST_STATE_SECRET: hex });
    expect(secret.length).toBe(32);
    expect(Buffer.from(secret).toString("hex")).toBe(hex);
  });

  it("accepts a 32+ byte base64 secret", () => {
    const raw = "abcdefghijklmnopqrstuvwxyz123456";
    const base64 = Buffer.from(raw, "utf8").toString("base64");
    const secret = getRequestStateSecret({ MCP_REQUEST_STATE_SECRET: base64 });
    expect(secret.length).toBe(32);
    expect(Buffer.from(secret).toString("utf8")).toBe(raw);
  });

  it("accepts a 32+ byte utf8 secret", () => {
    const raw = "plain utf8 secret with spaces 0123456789!!";
    const secret = getRequestStateSecret({ MCP_REQUEST_STATE_SECRET: raw });
    expect(secret.length).toBe(42);
    expect(Buffer.from(secret).equals(Buffer.from(raw, "utf8"))).toBe(true);
  });
});
