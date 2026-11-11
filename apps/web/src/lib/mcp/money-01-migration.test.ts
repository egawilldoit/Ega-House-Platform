import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

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
  it("is the journal tail with a later timestamp than 0092", () => {
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags.at(-1)).toBe("0093_money_01_finance_grants");
    const last = journal.entries.at(-1)!;
    const previous = journal.entries.at(-2)!;
    expect(last.when).toBeGreaterThan(previous.when);
  });

  it("stores the finance and combined profiles with their exact unions", () => {
    expect(migration).toContain("'personal_operations'");
    expect(migration).toContain("'personal_operations_writer'");
    expect(migration).toContain("'workspace_money_reader'");
    expect(migration).toContain("'workspace_money_writer'");
    expect(migration).toContain(
      '"personal_ops.read", "personal_ops.write"]\'::jsonb',
    );
    // The reader union never carries a write permission.
    expect(migration).toContain(
      '\'["projects.read", "goals.read", "tasks.read", "today.read", "timer.read", "personal_ops.read"]\'::jsonb',
    );
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

    expect(migration).not.toMatch(/personal_expenses_direct_user_delete[\s\S]*CREATE POLICY/);
    expect(migration).not.toContain("GRANT DELETE");
  });
});
