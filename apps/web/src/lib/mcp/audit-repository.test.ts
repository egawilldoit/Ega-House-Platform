import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import {
  MCP_CAPABILITIES,
  type McpCapability,
} from "@/lib/mcp/capability-registry";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { writeMcpAuditEvent } from "@/lib/mcp/audit-repository";

const PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-0000-0000-000000000001",
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "read_only",
  permissionsVersion: 1,
  permissions: getPermissionsForProfile("read_only", 1),
};

function createClient(result: { data?: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient<McpDatabase>,
    rpc,
  };
}

describe("writeMcpAuditEvent", () => {
  it("writes a successful token-free MCP invocation event", async () => {
    const mock = createClient({ data: "20000000-0000-0000-0000-000000000001", error: null });

    await expect(
      writeMcpAuditEvent(mock.client, {
        principal: PRINCIPAL,
        requestId: "request-1",
        toolName: "ega_list_projects",
        outcome: "success",
        durationMs: 12,
        metadata: { resultCount: 3 },
      }),
    ).resolves.toBeUndefined();

    expect(mock.rpc).toHaveBeenCalledWith("record_mcp_audit_event", {
      p_request_id: "request-1",
      p_tool_name: "ega_list_projects",
      p_outcome: "success",
      p_duration_ms: 12,
      p_error_code: null,
      p_metadata: { resultCount: 3 },
    });
  });

  it("writes stable failure information without exception details", async () => {
    const mock = createClient({ error: null });

    await writeMcpAuditEvent(mock.client, {
      principal: PRINCIPAL,
      requestId: "request-2",
      toolName: "ega_list_tasks",
      outcome: "error",
      durationMs: 4,
      errorCode: "DEPENDENCY_UNAVAILABLE",
    });

    expect(mock.rpc).toHaveBeenCalledWith("record_mcp_audit_event", expect.objectContaining({
      p_outcome: "error",
      p_error_code: "DEPENDENCY_UNAVAILABLE",
      p_metadata: {},
    }));
  });

  it("does not send caller-controlled principal identity to the RPC", async () => {
    const mock = createClient({ data: "20000000-0000-0000-0000-000000000002", error: null });

    await writeMcpAuditEvent(mock.client, {
      principal: PRINCIPAL,
      requestId: "request-identity",
      toolName: "ega_list_tasks",
      outcome: "success",
      durationMs: 1,
    });

    expect(mock.rpc.mock.calls[0]?.[1]).not.toEqual(expect.objectContaining({
      owner_user_id: expect.anything(),
      oauth_client_id: expect.anything(),
      grant_id: expect.anything(),
      resource_uri: expect.anything(),
    }));
    expect(mock.rpc.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      p_request_id: "request-identity",
      p_tool_name: "ega_list_tasks",
      p_outcome: "success",
    }));
  });

  it("rejects an RPC failure without exposing database details", async () => {
    const mock = createClient({
      error: { message: "permission denied: sensitive database detail" },
    });

    await expect(
      writeMcpAuditEvent(mock.client, {
        principal: PRINCIPAL,
        requestId: "request-rpc-error",
        toolName: "ega_list_tasks",
        outcome: "success",
        durationMs: 1,
      }),
    ).rejects.toThrow("Failed to persist EGA MCP audit event.");
  });

  it("rejects negative or non-integer durations before writing", async () => {
    const mock = createClient({ error: null });

    await expect(
      writeMcpAuditEvent(mock.client, {
        principal: PRINCIPAL,
        requestId: "request-3",
        toolName: "ega_list_tasks",
        outcome: "success",
        durationMs: -1,
      }),
    ).rejects.toThrow("MCP audit duration must be a non-negative integer.");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});

const drizzlePath = (...segments: string[]): string =>
  resolve(process.cwd(), "..", "..", "drizzle", ...segments);

const readMigration = (name: string): string =>
  readFileSync(drizzlePath(name), "utf8");

/**
 * Extracts tool -> required permissions from
 * private.mcp_tool_audit_permissions, the database's copy of the capability
 * registry's authorization statement (drizzle/0073).
 *
 * Driven from the journal in application order and reading the last migration
 * that defines the function, matching how the migrations are applied. This
 * mirrors readAuditToolAllowlist in capability-registry-migration.test.ts, which
 * does the same walk for the registration allowlist; the two guards are separate
 * because the facts are separate - that a tool EXISTS is not the same statement
 * as which permission it REQUIRES.
 */
function readSqlAuditPermissions(): Map<string, string[]> {
  const journal = JSON.parse(
    readFileSync(drizzlePath("meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };

  const migrations = [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => `${entry.tag}.sql`)
    .filter((name) => {
      try {
        return readMigration(name).includes("FUNCTION private.mcp_tool_audit_permissions");
      } catch {
        return false;
      }
    });

  let latest: string | undefined;
  for (const migration of migrations) {
    if (readMigration(migration).includes("FUNCTION private.mcp_tool_audit_permissions")) {
      latest = migration;
    }
  }

  if (latest === undefined) {
    throw new Error("No migration defines private.mcp_tool_audit_permissions.");
  }

  const body = readMigration(latest).slice(
    readMigration(latest).indexOf("FUNCTION private.mcp_tool_audit_permissions"),
  );

  const permissions = new Map<string, string[]>();
  for (const match of body.matchAll(/WHEN '(ega_[a-z0-9_]+)' THEN ARRAY\[([^\]]*)\]/g)) {
    const required = [...match[2].matchAll(/'([a-z_.]+)'/g)].map((entry) => entry[1]);
    permissions.set(match[1], required);
  }
  return permissions;
}

/** The registry requirement as the database must encode it: a permission list. */
function registryRequirement(capability: McpCapability): string[] {
  const requirement = capability.permissionRequirement;
  if (requirement.kind === "always") return [];
  if (requirement.kind === "allOf") return [...requirement.permissions];
  return [...requirement.permissions];
}

/**
 * The database, not the application, decides whether an audit row naming a
 * capability may be written.
 *
 * The MCP bearer reaches record_mcp_audit_event through PostgREST with the raw
 * access token (supabase-user-client.ts), so an attacker who skips /api/mcp
 * runs no TypeScript at all. That makes the SQL copy of the registry's
 * authorization statement load-bearing for the integrity of the ledger, and
 * makes divergence in EITHER direction a real defect:
 *
 *   - SQL requires less than the registry -> a principal can record a success
 *     row for a capability it cannot invoke, which is the forgeable-ledger defect
 *   - SQL requires more than the registry -> a legitimate audit write is refused
 *     and the read handlers surface DEPENDENCY_UNAVAILABLE to the client
 */
describe("the audit RPC's SQL capability authority matches the runtime registry", () => {
  it("requires exactly the registry's permission for every capability", () => {
    const sqlPermissions = readSqlAuditPermissions();
    const mismatched: Array<{ tool: string; sql: string[]; registry: string[] }> = [];

    for (const capability of MCP_CAPABILITIES) {
      const expected = registryRequirement(capability);
      const actual = sqlPermissions.get(capability.name);
      if (actual === undefined) continue; // reported by the reverse-direction test
      if (actual.length !== expected.length || actual.some((p, i) => p !== expected[i])) {
        mismatched.push({ tool: capability.name, sql: actual, registry: expected });
      }
    }

    expect(
      mismatched,
      "private.mcp_tool_audit_permissions disagrees with the capability registry; the database would accept an audit the runtime forbids, or refuse one it allows",
    ).toEqual([]);
  });

  it("states a requirement for every capability and nothing else", () => {
    const sqlPermissions = readSqlAuditPermissions();
    const registryNames = new Set(MCP_CAPABILITIES.map((capability) => capability.name));

    const missing = [...registryNames].filter((name) => !sqlPermissions.has(name));
    expect(
      missing,
      "capabilities exist in the runtime registry but not in private.mcp_tool_audit_permissions; widen the SQL authorization statement in the same wave as the handler",
    ).toEqual([]);

    const extra = [...sqlPermissions.keys()].filter((name) => !registryNames.has(name));
    expect(
      extra,
      "private.mcp_tool_audit_permissions authorizes a tool identity with no executable implementation; a planned tool must never be auditable before it has a handler",
    ).toEqual([]);
  });

  it("encodes only requirement shapes the allOf SQL check can represent", () => {
    // The SQL expresses one requirement as an allOf set that the grant must
    // contain. An anyOf capability cannot be encoded that way: a grant holding
    // only one of several alternative permissions would be refused, so the
    // ledger would record a denial for a call the runtime permits. No capability
    // is anyOf today; this fails the day one appears instead of silently
    // under-authorizing it.
    const unsupported = MCP_CAPABILITIES.filter(
      (capability) => capability.permissionRequirement.kind === "anyOf",
    );
    expect(
      unsupported.map((capability) => capability.name),
      "an anyOf capability cannot be expressed by the SQL allOf containment check; extend private.mcp_tool_audit_permissions to represent it",
    ).toEqual([]);
  });

  it("gates only the success outcome in the RPC", () => {
    const migration = readMigration("0073_mcp_audit_capability_authority.sql");

    // A 'denied' row is how the product records a call the principal was NOT
    // authorized to make (audited-write-handlers getOutcome maps
    // PERMISSION_DENIED and RATE_LIMITED to 'denied'). Gating every outcome
    // would make the refusal record unwritable, so the condition must name
    // 'success' explicitly.
    expect(migration).toContain("IF p_outcome = 'success'");
    expect(migration).toContain("v_grant_permissions @> to_jsonb(v_required_permissions)");
  });

  it("derives registration from the authorization statement rather than restating it", () => {
    const migration = readMigration("0073_mcp_audit_capability_authority.sql");
    const body = migration.slice(migration.indexOf("FUNCTION private.mcp_tool_audit_permissions"));

    // One list, not two. A tool name appearing inside the authorization
    // statement is the whole catalog; a second restatement inside the
    // registration predicate is the drift 0067 was written to stop.
    const inPredicate = migration.slice(
      migration.indexOf("FUNCTION private.is_registered_mcp_tool"),
      migration.indexOf("FUNCTION private.mcp_tool_audit_permissions"),
    );
    expect(
      [...inPredicate.matchAll(/'(ega_[a-z0-9_]+)'/g)].map((match) => match[1]),
      "private.is_registered_mcp_tool must delegate to the authorization statement instead of carrying a second tool list",
    ).toEqual([]);
    expect(body).toContain("ELSE NULL");
  });
});
