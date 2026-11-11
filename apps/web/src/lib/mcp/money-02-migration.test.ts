import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "..",
    "..",
    "drizzle/0094_money_02_expense_management.sql",
  ),
  "utf8",
);

const journal = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "..", "..", "drizzle/meta/_journal.json"),
    "utf8",
  ),
) as { entries: Array<{ idx: number; tag: string; when: number }> };

describe("MONEY-02 expense management migration", () => {
  it("uses the reserved journal index and timestamp", () => {
    const entry = journal.entries.find(
      (item) => item.tag === "0094_money_02_expense_management",
    );
    expect(entry).toEqual(
      expect.objectContaining({
        idx: 107,
        when: 1787880000057,
      }),
    );
    const previous = journal.entries.find(
      (item) => item.tag === "0093_money_01_finance_grants",
    )!;
    expect(entry!.when).toBeGreaterThan(previous.when);
  });

  it("adds only the active canonical read index and no second ledger", () => {
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "personal_expenses_owner_active_read_idx"',
    );
    expect(migration).toContain('WHERE "deleted_at" IS NULL');
    expect(migration).toContain('INCLUDE ("category", "amount_minor")');
    expect(migration).not.toMatch(/CREATE TABLE/i);
    expect(migration).not.toMatch(/ALTER TABLE/i);
    expect(migration).not.toMatch(/CREATE POLICY/i);
  });

  it("does not add a DELETE path or weaken the MONEY-01 invariants", () => {
    expect(migration).not.toContain("GRANT DELETE");
    expect(migration).not.toMatch(/DROP\s+TRIGGER/i);
    expect(migration).not.toMatch(/DROP\s+POLICY/i);
  });

  it("separates every statement with the CI breakpoint marker", () => {
    const chunks = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    // Leading comments are their own chunk; exactly one executable statement
    // follows and the file ends with a terminated statement.
    const executable = chunks.filter((statement) => /CREATE INDEX/.test(statement));
    expect(executable).toHaveLength(1);
    expect(executable[0].endsWith(";")).toBe(true);
    expect(migration).toContain("--> statement-breakpoint");
  });
});
