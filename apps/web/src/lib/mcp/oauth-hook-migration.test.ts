import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "drizzle/0042_fix_mcp_oauth_hook_variable_ambiguity.sql",
);

describe("MCP OAuth token-hook compatibility migration", () => {
  it("uses unambiguous PL/pgSQL variable names", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("v_oauth_client_id text");
    expect(migration).toContain(
      "grant_record.oauth_client_id = v_oauth_client_id",
    );
    expect(migration).not.toMatch(/^\s*oauth_client_id text;/m);
    expect(migration).not.toContain(
      "grant_record.oauth_client_id = oauth_client_id",
    );
  });

  it("preserves exact resource-bound audience assignment", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("grant_record.owner_user_id = v_user_id");
    expect(migration).toContain("grant_record.status = 'active'");
    expect(migration).toContain("grant_record.revoked_at IS NULL");
    expect(migration).toContain("to_jsonb(v_granted_resource_uri)");
    expect(migration).toContain("TO supabase_auth_admin");
    expect(migration).toContain("FROM authenticated, anon, public");
  });
});
