import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const foundationMigrationPath = resolve(
  process.cwd(),
  "drizzle/0037_mcp_oauth_foundation.sql",
);
const rlsMigrationPath = resolve(
  process.cwd(),
  "drizzle/0038_mcp_read_only_rls.sql",
);

function readFoundationMigration(): string {
  return readFileSync(foundationMigrationPath, "utf8");
}

function readRlsMigration(): string {
  return readFileSync(rlsMigrationPath, "utf8");
}

describe("MCP OAuth foundation migration", () => {
  it("does not allow authenticated clients to create or activate grants", () => {
    const migration = readFoundationMigration();

    expect(migration).not.toMatch(
      /CREATE POLICY "mcp_grants_(?:insert|update|delete)[^"]*"/,
    );
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE\n  ON TABLE \"mcp_authorization_grants\"\n  FROM authenticated, anon;",
    );
    expect(migration).toContain(
      'CREATE POLICY "mcp_grants_select_own"',
    );
  });

  it("binds every grant and issued OAuth token to an MCP resource", () => {
    const migration = readFoundationMigration();

    expect(migration).toContain('"resource_uri" text NOT NULL');
    expect(migration).toContain("custom_access_token_hook");
    expect(migration).toContain("jsonb_set(claims, '{aud}'");
    expect(migration).toContain("GRANT EXECUTE");
    expect(migration).toContain("TO supabase_auth_admin");
    expect(migration).toContain("FROM authenticated, anon, public");
  });
});

describe("MCP read-only RLS migration", () => {
  it("removes unrestricted authenticated access", () => {
    expect(readRlsMigration()).not.toContain("USING (true)");
    expect(readRlsMigration()).not.toContain("WITH CHECK (true)");
  });

  it.each([
    ["projects", "projects.read"],
    ["goals", "goals.read"],
    ["tasks", "tasks.read"],
  ])("adds owner-scoped direct and OAuth read policies for %s", (table, permission) => {
    const migration = readRlsMigration();

    expect(migration).toContain(`${table}_direct_user_access`);
    expect(migration).toContain(`${table}_mcp_read_access`);
    expect(migration).toContain(`has_active_mcp_permission('${permission}')`);
  });

  it("requires the active grant to match the token audience", () => {
    expect(readRlsMigration()).toContain(
      "grant_record.resource_uri = (auth.jwt() ->> 'aud')",
    );
  });

  it("does not create OAuth write policies", () => {
    const migration = readRlsMigration();

    expect(migration).not.toMatch(/mcp_(insert|update|delete)_access/);
    expect(migration).not.toContain("tasks.create");
    expect(migration).not.toContain("tasks.update");
  });

  it("uses a restricted security-definer permission helper", () => {
    const migration = readRlsMigration();

    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION");
  });
});
