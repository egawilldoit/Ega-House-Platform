import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "..", "..", "drizzle/0061_mcp_audit_event_rpc.sql"),
  "utf8",
);
const auditRlsMigration = readFileSync(
  resolve(process.cwd(), "..", "..", "drizzle/0056_mcp_remaining_tables_rls_hardening.sql"),
  "utf8",
);

describe("claim-bound MCP audit event migration", () => {
  it("derives authorization identity from the verified JWT and active grant", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.record_mcp_audit_event(",
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("v_owner_user_id := (SELECT auth.uid());");
    expect(migration).toContain(
      "v_oauth_client_id := NULLIF((SELECT auth.jwt()) ->> 'client_id', '');",
    );
    expect(migration).toContain(
      "v_resource_uri := NULLIF((SELECT auth.jwt()) ->> 'aud', '');",
    );
    expect(migration).toContain("grant_record.status = 'active'");
    expect(migration).toContain("grant_record.revoked_at IS NULL");
    expect(migration).toContain("owner_user_id,");
    expect(migration).toContain("oauth_client_id,");
    expect(migration).toContain("grant_id,");
    expect(migration).not.toContain("p_owner_user_id");
    expect(migration).not.toContain("p_oauth_client_id");
    expect(migration).not.toContain("p_grant_id");
    expect(migration).not.toContain("p_resource_uri");
  });

  it("validates bounded event input and rejects missing authorization context", () => {
    expect(migration).toContain("ERRCODE = '42501'");
    expect(migration).toContain("char_length(p_request_id) > 64");
    expect(migration).toContain(
      "p_tool_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'",
    );
    expect(migration).toContain("p_outcome NOT IN ('success', 'error', 'denied')");
    expect(migration).toContain("p_duration_ms > 86400000");
    expect(migration).toContain("jsonb_typeof(p_metadata) <> 'object'");
    expect(migration).toContain("octet_length(p_metadata::text) > 16384");
  });

  it("keeps direct OAuth audit-table INSERT blocked and RPC execution explicit", () => {
    expect(auditRlsMigration).toContain('CREATE POLICY "agent_events_direct_user_insert"');
    expect(auditRlsMigration).toContain("((SELECT auth.jwt()) ->> 'client_id') IS NULL");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.record_mcp_audit_event(text, text, text, integer, text, jsonb) FROM PUBLIC",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.record_mcp_audit_event(text, text, text, integer, text, jsonb) FROM anon",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.record_mcp_audit_event(text, text, text, integer, text, jsonb) TO authenticated",
    );
  });
});
