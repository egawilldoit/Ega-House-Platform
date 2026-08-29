import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  canonicalMutationFingerprint,
  claimMcpMutation,
  failMcpMutation,
  storeMcpMutationResult,
} from "@/lib/mcp/mutation-idempotency";

type RpcResponse = { data: unknown; error: { message: string } | null };

function rpcClient(response: RpcResponse) {
  const rpc = vi.fn(async () => response);
  const client = { rpc } as unknown as SupabaseClient<McpDatabase>;
  return { client, rpc };
}

function concurrentClaimClient() {
  let state: { fingerprint: string; token: string; result?: Record<string, unknown> } | undefined;
  let tokenNumber = 0;
  const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => {
    if (!state) {
      state = {
        fingerprint: String(args.p_args_hash),
        token: `token-${++tokenNumber}`,
      };
      return { data: [{ claim_outcome: "CLAIM_GRANTED", claim_token: state.token, existing_result: null }], error: null };
    }
    if (state.fingerprint !== args.p_args_hash) {
      return { data: [{ claim_outcome: "CONFLICT", claim_token: null, existing_result: null }], error: null };
    }
    if (state.result) {
      return { data: [{ claim_outcome: "REPLAY", claim_token: null, existing_result: state.result }], error: null };
    }
    return { data: [{ claim_outcome: "IN_PROGRESS", claim_token: null, existing_result: null }], error: null };
  });
  return { client: { rpc } as unknown as SupabaseClient<McpDatabase>, rpc, complete: (result: Record<string, unknown>) => { if (state) state.result = result; } };
}

describe("canonicalMutationFingerprint determinism", () => {
  it("hashes identically regardless of key insertion order", () => {
    const a = canonicalMutationFingerprint("ega_create_task", { title: "T", projectId: "p1", status: "todo" });
    const b = canonicalMutationFingerprint("ega_create_task", { status: "todo", projectId: "p1", title: "T" });
    expect(a).toBe(b);
  });

  it("changes when any field value changes", () => {
    const a = canonicalMutationFingerprint("ega_create_task", { title: "T", priority: "high" });
    const b = canonicalMutationFingerprint("ega_create_task", { title: "T", priority: "low" });
    expect(a).not.toBe(b);
  });

  it("changes when the tool name changes (cross-tool collision impossible)", () => {
    const args = { title: "T" };
    const a = canonicalMutationFingerprint("ega_create_task", args);
    const b = canonicalMutationFingerprint("ega_create_goal", args);
    expect(a).not.toBe(b);
  });

  it("canonicalizes nested objects", () => {
    const a = canonicalMutationFingerprint("ega_create_task", { meta: { b: 2, a: { y: 1, x: 2 } } });
    const b = canonicalMutationFingerprint("ega_create_task", { meta: { a: { x: 2, y: 1 }, b: 2 } });
    expect(a).toBe(b);
  });

  it("drops undefined fields but keeps null", () => {
    const a = canonicalMutationFingerprint("ega_create_task", { title: "T", goalId: undefined });
    const b = canonicalMutationFingerprint("ega_create_task", { title: "T" });
    expect(a).toBe(b);
    const c = canonicalMutationFingerprint("ega_create_task", { title: "T", goalId: null });
    expect(a).not.toBe(c);
  });

  it("preserves strings exactly so semantically distinct arguments cannot replay", () => {
    const a = canonicalMutationFingerprint("ega_create_task", { title: "  Fix bug  " });
    const b = canonicalMutationFingerprint("ega_create_task", { title: "Fix bug" });
    expect(a).not.toBe(b);
  });

  it("preserves array order (order is semantically meaningful)", () => {
    const a = canonicalMutationFingerprint("ega_create_task", { tags: ["a", "b"] });
    const b = canonicalMutationFingerprint("ega_create_task", { tags: ["b", "a"] });
    expect(a).not.toBe(b);
  });
});

describe("claimMcpMutation", () => {
  it("maps CLAIM_GRANTED and forwards tool, operationId, fingerprint to the RPC", async () => {
    const token = "11111111-1111-4111-8111-111111111111";
    const { client, rpc } = rpcClient({
      data: [{ claim_outcome: "CLAIM_GRANTED", claim_token: token, existing_result: null }],
      error: null,
    });
    const claim = await claimMcpMutation(client, "ega_create_task", "op-1", "fingerprint-a");
    expect(claim).toEqual({ outcome: "CLAIM_GRANTED", claimToken: token });
    expect(rpc).toHaveBeenCalledWith("mcp_claim_mutation_receipt", {
      p_tool_name: "ega_create_task",
      p_operation_id: "op-1",
      p_args_hash: "fingerprint-a",
    });
  });

  it("maps IN_PROGRESS without a token", async () => {
    const { client } = rpcClient({
      data: [{ claim_outcome: "IN_PROGRESS", claim_token: null, existing_result: null }],
      error: null,
    });
    expect(await claimMcpMutation(client, "ega_create_task", "op-1", "fp")).toEqual({ outcome: "IN_PROGRESS" });
  });

  it("maps REPLAY with the stored result", async () => {
    const stored = { ok: true, task: { id: "t1" } };
    const { client } = rpcClient({
      data: [{ claim_outcome: "REPLAY", claim_token: null, existing_result: stored }],
      error: null,
    });
    expect(await claimMcpMutation(client, "ega_create_task", "op-1", "fp")).toEqual({
      outcome: "REPLAY",
      result: stored,
    });
  });

  it("maps CONFLICT", async () => {
    const { client } = rpcClient({
      data: [{ claim_outcome: "CONFLICT", claim_token: null, existing_result: null }],
      error: null,
    });
    expect(await claimMcpMutation(client, "ega_create_task", "op-1", "fp")).toEqual({ outcome: "CONFLICT" });
  });

  it("throws on RPC error (fail closed — no mutation)", async () => {
    const { client } = rpcClient({ data: null, error: { message: "ledger unavailable" } });
    await expect(claimMcpMutation(client, "ega_create_task", "op-1", "fp")).rejects.toThrow(
      "MCP mutation claim failed: ledger unavailable",
    );
  });

  it("throws when the RPC returns no outcome row", async () => {
    const { client } = rpcClient({ data: [], error: null });
    await expect(claimMcpMutation(client, "ega_create_task", "op-1", "fp")).rejects.toThrow(
      "MCP mutation claim returned no outcome.",
    );
  });

  it("throws when CLAIM_GRANTED arrives without a claim token", async () => {
    const { client } = rpcClient({
      data: [{ claim_outcome: "CLAIM_GRANTED", claim_token: null, existing_result: null }],
      error: null,
    });
    await expect(claimMcpMutation(client, "ega_create_task", "op-1", "fp")).rejects.toThrow(
      "MCP mutation claim granted without a claim token.",
    );
  });

  it("fails closed when REPLAY has no durable result", async () => {
    const { client } = rpcClient({
      data: [{ claim_outcome: "REPLAY", claim_token: null, existing_result: null }],
      error: null,
    });
    await expect(claimMcpMutation(client, "ega_create_task", "op-1", "fp")).rejects.toThrow(
      "MCP mutation replay returned no result.",
    );
  });

  it("allows exactly one of two concurrent callers to mutate", async () => {
    const { client } = concurrentClaimClient();
    const claims = await Promise.all([
      claimMcpMutation(client, "ega_create_task", "op-1", "fp"),
      claimMcpMutation(client, "ega_create_task", "op-1", "fp"),
    ]);
    expect(claims.filter((claim) => claim.outcome === "CLAIM_GRANTED")).toHaveLength(1);
    expect(claims.filter((claim) => claim.outcome === "IN_PROGRESS")).toHaveLength(1);
  });

  it("allows exactly one of ten concurrent callers to mutate", async () => {
    const { client } = concurrentClaimClient();
    const claims = await Promise.all(
      Array.from({ length: 10 }, () => claimMcpMutation(client, "ega_create_task", "op-1", "fp")),
    );
    expect(claims.filter((claim) => claim.outcome === "CLAIM_GRANTED")).toHaveLength(1);
    expect(claims.filter((claim) => claim.outcome === "IN_PROGRESS")).toHaveLength(9);
  });

  it("returns CONFLICT for concurrent reuse with different arguments", async () => {
    const { client } = concurrentClaimClient();
    await claimMcpMutation(client, "ega_create_task", "op-1", "fingerprint-a");
    await expect(claimMcpMutation(client, "ega_create_task", "op-1", "fingerprint-b")).resolves.toEqual({
      outcome: "CONFLICT",
    });
  });

  it("replays only the completed durable result", async () => {
    const ledger = concurrentClaimClient();
    await claimMcpMutation(ledger.client, "ega_create_task", "op-1", "fp");
    ledger.complete({ ok: true, task: { id: "task-1" } });
    await expect(claimMcpMutation(ledger.client, "ega_create_task", "op-1", "fp")).resolves.toEqual({
      outcome: "REPLAY",
      result: { ok: true, task: { id: "task-1" } },
    });
  });
});

describe("storeMcpMutationResult", () => {
  it("sends the claim token with the payload on success", async () => {
    const { client, rpc } = rpcClient({ data: null, error: null });
    await storeMcpMutationResult(client, "ega_create_task", "op-1", "token-1", { ok: true });
    expect(rpc).toHaveBeenCalledWith("mcp_store_mutation_result", {
      p_tool_name: "ega_create_task",
      p_operation_id: "op-1",
      p_claim_token: "token-1",
      p_result_payload: { ok: true },
    });
  });

  it("throws when the server rejects the claim token (SQLSTATE 02000 path)", async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: "Mutation receipt not found or claim token mismatch." },
    });
    await expect(storeMcpMutationResult(client, "ega_create_task", "op-1", "stale-token", { ok: true })).rejects.toThrow(
      "Failed to persist MCP mutation result: Mutation receipt not found or claim token mismatch.",
    );
  });

  it("fails closed when a worker tries to store after its lease expires", async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: "Mutation receipt not found or claim token mismatch." },
    });
    await expect(storeMcpMutationResult(client, "ega_create_task", "op-1", "expired-token", { ok: true })).rejects.toThrow(
      "Failed to persist MCP mutation result: Mutation receipt not found or claim token mismatch.",
    );
  });
});

describe("MCP receipt SQL fencing contract", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "..", "..", "drizzle/0047_mcp_mutation_receipts.sql"),
    "utf8",
  );

  it("serializes claims and exposes only the four explicit outcomes", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("claim_outcome := 'CLAIM_GRANTED'");
    expect(migration).toContain("claim_outcome := 'IN_PROGRESS'");
    expect(migration).toContain("claim_outcome := 'REPLAY'");
    expect(migration).toContain("claim_outcome := 'CONFLICT'");
  });

  it("requires the current unexpired claim token to store or fail a result", () => {
    const storeFunction = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.mcp_store_mutation_result"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.mcp_fail_mutation_result"),
    );
    const failFunction = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.mcp_fail_mutation_result"));
    expect(storeFunction).toContain("r.claim_token = p_claim_token");
    expect(storeFunction).toContain("r.lease_expires_at > now()");
    expect(failFunction.match(/r\.claim_token = p_claim_token/g)).toHaveLength(2);
    expect(failFunction.match(/r\.lease_expires_at > now\(\)/g)).toHaveLength(2);
  });
});

describe("failMcpMutation", () => {
  it("forwards the final flag and throws on RPC error", async () => {
    const okClient = rpcClient({ data: null, error: null });
    await failMcpMutation(okClient.client, "ega_create_task", "op-1", "token-1", true);
    expect(okClient.rpc).toHaveBeenCalledWith("mcp_fail_mutation_result", {
      p_tool_name: "ega_create_task",
      p_operation_id: "op-1",
      p_claim_token: "token-1",
      p_final: true,
    });

    const failing = rpcClient({ data: null, error: { message: "boom" } });
    await expect(failMcpMutation(failing.client, "ega_create_task", "op-1", "token-1", false)).rejects.toThrow(
      "Failed to record MCP mutation failure: boom",
    );
  });
});
