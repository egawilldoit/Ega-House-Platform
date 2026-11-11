import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MCP_PERMISSION_PROFILES,
  getPermissionsForProfile,
} from "@/lib/mcp/permissions";

const migration = readFileSync(
  resolve(process.cwd(), "..", "..", "drizzle/0093_money_01_finance_grants.sql"),
  "utf8",
);

const journal = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "..", "..", "drizzle/meta/_journal.json"),
    "utf8",
  ),
) as { entries: Array<{ tag: string; when: number }> };

describe("MONEY-01 finance grant migration", () => {
  it("is in the journal after 0092 with a later timestamp", () => {
    const tags = journal.entries.map((entry) => entry.tag);
    const index = tags.indexOf("0093_money_01_finance_grants");
    expect(index).toBeGreaterThan(tags.indexOf("0092_routine_metrics"));
    expect(journal.entries[index].when).toBeGreaterThan(
      journal.entries[index - 1].when,
    );
  });

  it("stores every runtime profile union exactly as the code advertises it", () => {
    // Parse the jsonb array literals from the migration and compare each
    // runtime profile's permissions by value. Re-ordering or editing
    // permissions.ts without the migration now fails here instead of at
    // consent time.
    const literals = [...migration.matchAll(/'(\[[^\]]*\])'::jsonb/g)].map(
      (match) => JSON.parse(match[1]) as string[],
    );

    for (const profile of MCP_PERMISSION_PROFILES) {
      expect(literals).toContainEqual(getPermissionsForProfile(profile));
    }

    // The reader union never carries a write permission.
    const reader = literals.find(
      (entry) =>
        entry.includes("personal_ops.read") &&
        entry.length === 6 &&
        !entry.includes("personal_ops.write"),
    );
    expect(reader).toEqual(getPermissionsForProfile("workspace_money_reader"));
  });

  it("resolves the active grant by owner, client, resource and revocation", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.mcp_finance_grant_allows(required_permission text)",
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("grant_record.owner_user_id = auth.uid()");
    expect(migration).toContain(
      "grant_record.oauth_client_id = auth.jwt() ->> 'client_id'",
    );
    expect(migration).toContain(
      "grant_record.resource_uri = auth.jwt() ->> 'aud'",
    );
    expect(migration).toContain("grant_record.status = 'active'");
    expect(migration).toContain("grant_record.revoked_at IS NULL");
    expect(migration).toContain(
      "grant_record.permissions ? required_permission",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.mcp_finance_grant_allows(text) FROM PUBLIC",
    );
  });

  it("keeps direct-user reads and requires the matching grant for OAuth reads", () => {
    const selectPolicy = migration.slice(
      migration.indexOf('CREATE POLICY "personal_expenses_direct_user_select"'),
      migration.indexOf('CREATE POLICY "personal_expenses_direct_user_insert"'),
    );
    expect(selectPolicy).toContain(
      "((SELECT auth.jwt()) ->> 'client_id') IS NULL",
    );
    expect(selectPolicy).toContain(
      "public.mcp_finance_grant_allows('personal_ops.read')",
    );
    expect(selectPolicy).not.toContain("personal_ops.write");
  });

  it("requires the write grant for insert and update and never adds DELETE", () => {
    const insertPolicy = migration.slice(
      migration.indexOf('CREATE POLICY "personal_expenses_direct_user_insert"'),
      migration.indexOf('CREATE POLICY "personal_expenses_direct_user_update"'),
    );
    expect(insertPolicy).toContain(
      "public.mcp_finance_grant_allows('personal_ops.write')",
    );

    const updatePolicy = migration.slice(
      migration.indexOf('CREATE POLICY "personal_expenses_direct_user_update"'),
    );
    expect(updatePolicy.match(/personal_ops\.write/g)).toHaveLength(2);

    expect(migration).not.toMatch(
      /CREATE POLICY "personal_expenses_[^"]*delete"/i,
    );
    expect(migration).not.toContain("GRANT DELETE");
  });
});
