import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const foundationMigrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "drizzle/0037_mcp_oauth_foundation.sql",
);
const rlsMigrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "drizzle/0038_mcp_read_only_rls.sql",
);
const hardeningMigrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "drizzle/0041_mcp_security_performance_hardening.sql",
);
const productionOwnerReconciliationMigrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "drizzle/0043_mcp_production_owner_reconciliation.sql",
);

function readFoundationMigration(): string {
  return readFileSync(foundationMigrationPath, "utf8");
}

function readRlsMigration(): string {
  return readFileSync(rlsMigrationPath, "utf8");
}

function readHardeningMigration(): string {
  return readFileSync(hardeningMigrationPath, "utf8");
}

function readProductionOwnerReconciliationMigration(): string {
  return readFileSync(productionOwnerReconciliationMigrationPath, "utf8");
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

describe("MCP database hardening migration", () => {
  it("moves the RLS helper out of the exposed public schema", () => {
    const migration = readHardeningMigration();

    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION private.has_active_mcp_permission",
    );
    expect(migration).toContain(
      "DROP FUNCTION IF EXISTS public.has_active_mcp_permission(text)",
    );
    expect(migration).toContain(
      "REVOKE ALL ON SCHEMA private FROM PUBLIC, anon",
    );
  });

  it("uses init-plan-safe auth expressions and one select policy per table", () => {
    const migration = readHardeningMigration();

    expect(migration).toContain("(SELECT auth.uid())");
    expect(migration).toContain("(SELECT auth.jwt())");
    for (const table of ["projects", "goals", "tasks"]) {
      expect(migration).toContain(`${table}_select_access`);
      expect(migration).toContain(`${table}_direct_user_insert`);
      expect(migration).toContain(`${table}_direct_user_update`);
      expect(migration).toContain(`${table}_direct_user_delete`);
    }
  });

  it("adds covering indexes and removes the duplicate audit owner index", () => {
    const migration = readHardeningMigration();

    expect(migration).toContain(
      "DROP INDEX IF EXISTS public.agent_integration_events_owner_idx",
    );
    expect(migration).toContain("agent_integration_events_grant_id_idx");
    expect(migration).toContain("agent_integration_events_token_id_idx");
    expect(migration).toContain("tasks_project_id_idx");
    expect(migration).toContain("tasks_goal_id_idx");
  });

  it("locks internal tables and the automatic RLS event function", () => {
    const migration = readHardeningMigration();

    expect(migration).toContain("agent_tokens_deny_client_access");
    expect(migration).toContain("mcp_rate_limits_deny_client_table_access");
    expect(migration).toContain("public.rls_auto_enable()");
    expect(migration).toContain(
      "FROM PUBLIC, anon, authenticated",
    );
  });
});

describe("MCP production ownership reconciliation migration", () => {
  it("resolves the approved owner dynamically without UUID aggregation or hardcoded IDs", () => {
    const migration = readProductionOwnerReconciliationMigration();

    expect(migration).toContain("lower(email) = 'ab.mortaki@gmail.com'");
    expect(migration).toContain("v_target_count <> 1");
    expect(migration).not.toContain("min(id)");
    expect(migration).toContain("SELECT id");
    expect(migration).toContain("LIMIT 1");
    expect(migration).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });

  it("repairs only invalid owners and fails on unresolved ownership", () => {
    const migration = readProductionOwnerReconciliationMigration();

    expect(migration).toContain("project_record.owner_user_id IS NULL");
    expect(migration).toContain("goal_record.owner_user_id IS NULL");
    expect(migration).toContain("task_record.owner_user_id IS NULL");
    expect(migration).toContain("NOT EXISTS (");
    expect(migration).toContain("FROM auth.users AS auth_user");
    expect(migration).toContain("Project ownership reconciliation failed.");
  });

  it("requires goal and task owners to match their parent project", () => {
    const migration = readProductionOwnerReconciliationMigration();

    expect(migration).toContain(
      "goal_record.owner_user_id IS DISTINCT FROM project_record.owner_user_id",
    );
    expect(migration).toContain(
      "task_record.owner_user_id IS DISTINCT FROM project_record.owner_user_id",
    );
  });
});
