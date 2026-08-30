import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "..", "..", "drizzle/0060_mcp_grant_resolution_rpc.sql"),
  "utf8",
);
const grantRlsMigration = readFileSync(
  resolve(process.cwd(), "..", "..", "drizzle/0056_mcp_remaining_tables_rls_hardening.sql"),
  "utf8",
);

describe("claim-bound MCP grant resolution migration", () => {
  it("derives every lookup identity from the verified JWT and fails closed", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.resolve_active_mcp_grant()",
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("auth.uid() IS NOT NULL");
    expect(migration).toContain("NULLIF(auth.jwt() ->> 'client_id', '') IS NOT NULL");
    expect(migration).toContain("NULLIF(auth.jwt() ->> 'aud', '') IS NOT NULL");
    expect(migration).toContain("grant_record.owner_user_id = auth.uid()");
    expect(migration).toContain("grant_record.oauth_client_id = auth.jwt() ->> 'client_id'");
    expect(migration).toContain("grant_record.resource_uri = auth.jwt() ->> 'aud'");
    expect(migration).toContain("grant_record.status = 'active'");
    expect(migration).toContain("grant_record.revoked_at IS NULL");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.resolve_active_mcp_grant() FROM PUBLIC");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.resolve_active_mcp_grant() FROM anon");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.resolve_active_mcp_grant() TO authenticated");
    expect(migration).not.toMatch(/resolve_active_mcp_grant\([^)]*p_/);
  });

  it("preserves the OAuth direct-table SELECT deny boundary", () => {
    expect(grantRlsMigration).toContain('CREATE POLICY "mcp_grants_direct_user_select"');
    expect(grantRlsMigration).toContain("((SELECT auth.jwt()) ->> 'client_id') IS NULL");
  });
});
