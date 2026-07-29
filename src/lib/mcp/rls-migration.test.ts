import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "drizzle/0038_mcp_read_only_rls.sql",
);

function readMigration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("MCP read-only RLS migration", () => {
  it("removes unrestricted authenticated access", () => {
    expect(readMigration()).not.toContain("USING (true)");
    expect(readMigration()).not.toContain("WITH CHECK (true)");
  });

  it.each([
    ["projects", "projects.read"],
    ["goals", "goals.read"],
    ["tasks", "tasks.read"],
  ])("adds owner-scoped direct and OAuth read policies for %s", (table, permission) => {
    const migration = readMigration();

    expect(migration).toContain(`${table}_direct_user_access`);
    expect(migration).toContain(`${table}_mcp_read_access`);
    expect(migration).toContain(`has_active_mcp_permission('${permission}')`);
  });

  it("does not create OAuth write policies", () => {
    const migration = readMigration();

    expect(migration).not.toMatch(/mcp_(insert|update|delete)_access/);
    expect(migration).not.toContain("tasks.create");
    expect(migration).not.toContain("tasks.update");
  });

  it("uses a restricted security-definer permission helper", () => {
    const migration = readMigration();

    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION");
  });
});
