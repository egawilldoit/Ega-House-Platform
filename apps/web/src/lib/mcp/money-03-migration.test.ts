import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "..", "..", "drizzle/0095_money_03_periods.sql"),
  "utf8",
);

const journal = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "..", "..", "drizzle/meta/_journal.json"),
    "utf8",
  ),
) as {
  entries: Array<{
    idx: number;
    version: string;
    tag: string;
    when: number;
    breakpoints: boolean;
  }>;
};

describe("MONEY-03 period migration", () => {
  it("is the reserved journal entry with the reserved tag and timestamp", () => {
    const entry = journal.entries.find(
      (item) => item.tag === "0095_money_03_periods",
    );
    expect(entry).toEqual({
      idx: 108,
      version: "7",
      when: 1787880000058,
      tag: "0095_money_03_periods",
      breakpoints: true,
    });
    expect(journal.entries.at(-1)?.tag).toBe("0095_money_03_periods");
    const previous = journal.entries.at(-2)!;
    expect(journal.entries.at(-1)!.when).toBeGreaterThan(previous.when);
  });

  it("uses statement breakpoints for every new statement", () => {
    const breakpoints = migration.match(/--> statement-breakpoint/g) ?? [];
    expect(breakpoints.length).toBeGreaterThan(40);
  });

  it("adds the opening kind additively and preserves existing ids and values", () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "kind" varchar(32)');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "direction"');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "booking_date"');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "period_id"');
    expect(migration).not.toMatch(/DROP TABLE/i);
    expect(migration).not.toMatch(/DELETE FROM\s+public\.personal_expenses/i);
    expect(migration).not.toMatch(/TRUNCATE/i);
    // Legacy backfill never rewrites the version or the timestamped value.
    const backfill = migration.slice(
      migration.indexOf("UPDATE public.personal_expenses"),
      migration.indexOf('ALTER TABLE public.personal_expenses\n  ALTER COLUMN "occurred_at" DROP NOT NULL'),
    );
    expect(backfill).toContain('SET "kind" = \'expense\'');
    expect(backfill).toContain('expense."occurred_at" AT TIME ZONE');
    expect(backfill).not.toContain('"version"');
    expect(backfill).not.toContain('"amount_minor"');
  });

  it("allows known zero only for opening and keeps every other amount positive", () => {
    const amountCheck = migration.slice(
      migration.indexOf('ADD CONSTRAINT "personal_expenses_amount_minor_check"'),
      migration.indexOf('ADD CONSTRAINT "personal_expenses_kind_check"'),
    );
    expect(amountCheck).toContain('"kind" = \'opening\' AND "amount_minor" >= 0');
    expect(amountCheck).toContain('"kind" <> \'opening\' AND "amount_minor" >= 1');
    expect(migration).toContain(
      '("kind" <> \'opening\' OR "period_id" IS NOT NULL)',
    );
    expect(migration).toContain(
      '("kind" <> \'expense\' OR "direction" = \'out\')',
    );
    expect(migration).toContain(
      '("kind" = \'expense\' AND "category" IS NOT NULL AND "need_vs_want" IS NOT NULL)',
    );
  });

  it("stores exactly one opening per owner and period and never deletes it", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "personal_expenses_owner_period_opening_unique"',
    );
    const index = migration.slice(
      migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS "personal_expenses_owner_period_opening_unique"'),
      migration.indexOf('CREATE INDEX IF NOT EXISTS "personal_expenses_owner_booking_date_idx"'),
    );
    expect(index).toContain('WHERE "kind" = \'opening\'');
    expect(migration).toContain(
      "An opening movement cannot be deleted; correct it instead.",
    );
    expect(migration).toContain(
      "An opening movement is date-only and must not claim an instant.",
    );
  });

  it("creates the period state with inclusive bounds, one tracking period and evidence rules", () => {
    expect(migration).toContain('"money_periods_range_check" CHECK ("start_date" <= "end_date")');
    expect(migration).toContain(
      '"money_periods_active_date_check" CHECK ("active_date" >= "start_date" AND "active_date" <= "end_date")',
    );
    expect(migration).toContain(
      "\"lifecycle\" IN ('tracking', 'ended', 'rolled_over')",
    );
    expect(migration).toContain(
      "\"initialization\" IN ('uninitialized', 'initialized', 'reconciled')",
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "money_periods_owner_tracking_unique"',
    );
    expect(migration).toContain('WHERE "lifecycle" = \'tracking\'');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "money_periods_owner_range_unique"');
    expect(migration).toContain(
      '("provenance" #>> \'{opening,source}\') = \'verified_source\'',
    );
    expect(migration).toContain(
      'NULLIF(btrim(COALESCE("provenance" #>> \'{opening,evidence}\', \'\')), \'\') IS NOT NULL',
    );
    expect(migration).toContain(
      "Period initialization cannot lose recorded evidence.",
    );
  });

  it("mirrors the MONEY-01 grant rule and never adds a DELETE path", () => {
    const selectPolicy = migration.slice(
      migration.indexOf('CREATE POLICY "money_periods_direct_user_select"'),
      migration.indexOf('CREATE POLICY "money_periods_direct_user_insert"'),
    );
    expect(selectPolicy).toContain("public.mcp_finance_grant_allows('personal_ops.read')");
    expect(selectPolicy).toContain("((SELECT auth.jwt()) ->> 'client_id') IS NULL");
    expect(selectPolicy).not.toContain("personal_ops.write");

    const insertPolicy = migration.slice(
      migration.indexOf('CREATE POLICY "money_periods_direct_user_insert"'),
      migration.indexOf('CREATE POLICY "money_periods_direct_user_update"'),
    );
    expect(insertPolicy).toContain("public.mcp_finance_grant_allows('personal_ops.write')");

    expect(migration).not.toMatch(/CREATE POLICY "money_periods_[^"]*delete"/i);
    expect(migration).not.toContain("GRANT DELETE");
    expect(migration).not.toContain("getSupabaseServiceClient");
    expect(migration).not.toContain("SERVICE_ROLE");
  });

  it("writes period+opening atomically with auth.uid ownership and no caller owner", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.money_create_period(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.money_update_period(");
    const createFunction = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.money_create_period("),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.money_update_period("),
    );
    expect(createFunction).toContain("v_owner uuid := auth.uid();");
    expect(createFunction).not.toContain("p_owner");
    expect(createFunction).toContain("'opening:' || v_period_id");
    expect(createFunction).toContain('"direction"');
    expect(createFunction).toContain("p_opening_create_fingerprint");

    const updateFunction = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.money_update_period("),
    );
    expect(updateFunction).toContain("FOR UPDATE");
    expect(updateFunction).toContain('v_period."version" <> p_expected_version');
    expect(updateFunction).toContain('v_period."lifecycle" <> \'tracking\'');
    expect(updateFunction).toContain('"version" = "version" + 1');
    expect(updateFunction).not.toContain("p_owner");
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.money_create_period(",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.money_update_period(",
    );
  });

  it("does not invent a period or opening for existing expense-only accounts", () => {
    const setup = migration.slice(
      0,
      migration.indexOf("CREATE OR REPLACE FUNCTION public.money_create_period("),
    );
    expect(setup).not.toMatch(/INSERT INTO public\.money_periods/i);
    expect(setup).not.toContain("'opening', 'in'");
    expect(setup).not.toMatch(/INSERT INTO public\.personal_expenses[\s\S]*'opening'/i);
  });
});
