import type { SupabaseClient } from "@supabase/supabase-js";

import { createHash } from "node:crypto";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

export type McpClaimOutcome = "CLAIM_GRANTED" | "IN_PROGRESS" | "REPLAY" | "CONFLICT";

export type McpMutationClaim =
  | { outcome: "CLAIM_GRANTED"; claimToken: string }
  | { outcome: "IN_PROGRESS" }
  | { outcome: "REPLAY"; result: Record<string, unknown> }
  | { outcome: "CONFLICT" };

type McpUserClient = SupabaseClient<McpDatabase>;

// Canonicalizes a value for fingerprinting: object keys are recursively sorted,
// `undefined` properties are dropped (in arrays they become `null`, matching
// JSON semantics), `null` is kept as null, strings are preserved exactly, and non-finite
// numbers are stringified so NaN/Infinity cannot collapse into null. Array
// order is preserved because element order is semantically meaningful.
function canonicalizeFingerprintValue(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalizeFingerprintValue(item)));
  }
  switch (typeof value) {
    case "string":
      return value;
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "object": {
      if (value instanceof Date) return value.toISOString();
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, canonicalizeFingerprintValue(item)] as const)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      return Object.fromEntries(entries);
    }
    default:
      return value === undefined ? null : String(value);
  }
}

// Computes the durable fingerprint stored in mcp_mutation_receipts.args_hash.
// The tool name is hashed INSIDE the structure ({"tool":...,"args":...}) so the
// same arguments under different tools can never collide.
//
// CALLERS MUST PASS THE FULL NORMALIZED INPUT of the mutation — every semantic
// field that can change the effect of the mutation must be present (e.g. for
// tasks: title, projectId, goalId, description, status, priority, dueDate,
// estimateMinutes, and any scheduling fields; for projects: name, slug,
// description). A fingerprint computed from a partial input would let the same
// operation_id replay across genuinely different mutations. Do not include the
// operationId itself; it is already the receipt key's fourth component.
export function canonicalMutationFingerprint(toolName: string, input: Record<string, unknown>): string {
  const canonical = canonicalizeFingerprintValue({ tool: toolName, args: input });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

type McpClaimRpcRow = {
  claim_outcome: string;
  claim_token: string | null;
  existing_result: Record<string, unknown> | null;
};

// Claims the receipt for (toolName, operationId) with the given fingerprint.
// Throws (fail closed — never mutate) when the RPC errors, returns no outcome,
// or grants a claim without a token.
export async function claimMcpMutation(
  client: McpUserClient,
  toolName: string,
  operationId: string,
  fingerprint: string,
): Promise<McpMutationClaim> {
  const { data, error } = await (client as unknown as SupabaseClient).rpc("mcp_claim_mutation_receipt", {
    p_tool_name: toolName,
    p_operation_id: operationId,
    p_args_hash: fingerprint,
  });
  if (error) {
    throw new Error(`MCP mutation claim failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as McpClaimRpcRow | undefined;
  if (!row?.claim_outcome) {
    throw new Error("MCP mutation claim returned no outcome.");
  }
  switch (row.claim_outcome) {
    case "CLAIM_GRANTED":
      if (!row.claim_token) {
        throw new Error("MCP mutation claim granted without a claim token.");
      }
      return { outcome: "CLAIM_GRANTED", claimToken: row.claim_token };
    case "IN_PROGRESS":
      return { outcome: "IN_PROGRESS" };
    case "REPLAY":
      if (!row.existing_result || Array.isArray(row.existing_result)) {
        throw new Error("MCP mutation replay returned no result.");
      }
      return { outcome: "REPLAY", result: row.existing_result };
    case "CONFLICT":
      return { outcome: "CONFLICT" };
    default:
      throw new Error(`MCP mutation claim returned unknown outcome: ${row.claim_outcome}`);
  }
}

// Persists the mutation result behind the claim token. Throws when the RPC
// errors or the server rejects the token/status (SQLSTATE 02000).
export async function storeMcpMutationResult(
  client: McpUserClient,
  toolName: string,
  operationId: string,
  claimToken: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await (client as unknown as SupabaseClient).rpc("mcp_store_mutation_result", {
    p_tool_name: toolName,
    p_operation_id: operationId,
    p_claim_token: claimToken,
    p_result_payload: payload,
  });
  if (error) {
    throw new Error(`Failed to persist MCP mutation result: ${error.message}`);
  }
}

// Records a failed execution. `final` = true marks the receipt FAILED_FINAL
// (kept as an audit trail, later re-claimable); false deletes the receipt so
// the next claim starts fresh. Throws when the RPC errors or the token is stale.
export async function failMcpMutation(
  client: McpUserClient,
  toolName: string,
  operationId: string,
  claimToken: string,
  final: boolean,
): Promise<void> {
  const { error } = await (client as unknown as SupabaseClient).rpc("mcp_fail_mutation_result", {
    p_tool_name: toolName,
    p_operation_id: operationId,
    p_claim_token: claimToken,
    p_final: final,
  });
  if (error) {
    throw new Error(`Failed to record MCP mutation failure: ${error.message}`);
  }
}
