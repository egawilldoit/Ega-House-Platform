import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "..", "..", "drizzle/0096_money_04_movements.sql"),
  "utf8",
);

const previousMigration = readFileSync(
  resolve(process.cwd(), "..", "..", "drizzle/0095_money_03_periods.sql"),
  "utf8",
);

const journal = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "..", "..", "drizzle/meta/_journal.json"),
    "utf8",
  ),
) as { entries: Array<{ idx: number; tag: string; when: number }> };

describe("MONEY-04 movement migration", () => {
  it("uses the reserved journal position and strictly increasing timestamp", () => {
    const entry = journal.entries.find(
      (candidate) => candidate.tag === "0096_money_04_movements",
    );
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(109);
    expect(entry?.when).toBe(1787880000059);
    const previous = journal.entries.at(-2)!;
    expect(previous.tag).toBe("0095_money_03_periods");
    expect(entry!.when).toBeGreaterThan(previous.when);
  });

  it("additively extends the one ledger after MONEY-03 instead of creating another store", () => {
    expect(migration).toContain('ALTER TABLE "public"."personal_expenses"');
    expect(migration).not.toMatch(/CREATE TABLE[^;]*personal_(expenses|movements)/i);
    expect(migration).not.toMatch(/CREATE TABLE[^;]*money_(movements|ledger|periods)/i);
    // MONEY-03 already owns the shared movement columns; 0096 adds only
    // `purpose` and never re-declares or narrows them.
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "purpose" varchar(16)');
    expect(migration).not.toContain('"direction" varchar(3)');
  });

  it("derives the kind-aware daily default at insert instead of a single column default", () => {
    expect(previousMigration).toContain(
      '"counts_in_daily" boolean NOT NULL DEFAULT true',
    );
    expect(migration).toContain('ALTER COLUMN "counts_in_daily" DROP DEFAULT');
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fill_personal_expense_movement_fields()");
    expect(migration).toContain('IF NEW."counts_in_daily" IS NULL THEN');
    expect(migration).toContain('(NEW."kind" = \'expense\')');
    expect(migration).toContain('IF NEW."booking_date" IS NULL THEN');
  });

  it("never replaces the stronger MONEY-03 booking-date and update guards", () => {
    // 0095 recomputes the booking day when occurred_at changes and protects the
    // opening row; a later weaker replacement would silently regress that.
    expect(previousMigration).toContain("set_personal_expense_booking_date");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.set_personal_expense_booking_date");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.enforce_personal_expense_update");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.enforce_personal_expense_opening");
    expect(migration).not.toContain("DROP TRIGGER IF EXISTS \"personal_expenses_update_guard\"");
    expect(migration).not.toContain("DROP TRIGGER IF EXISTS \"personal_expenses_booking_date_trigger\"");
  });

  it("allows all five kinds without fictional expense fields", () => {
    const shape = migration.slice(
      migration.indexOf('ADD CONSTRAINT "personal_expenses_kind_shape_check"'),
    );
    expect(shape).toContain('"kind" = \'expense\'');
    expect(shape).toContain('"kind" IN (\'income\', \'opening\')');
    expect(shape).toContain('"kind" = \'savings_transfer\'');
    expect(shape).toContain('"kind" = \'reconciliation_adjustment\'');
    expect(shape).toContain('"category" IS NULL');
    expect(shape).toContain('"purpose" IS NULL');
    // The opening zero rule stays with 0095's amount check; this migration
    // must not weaken it.
    expect(previousMigration).toContain(
      "(\"kind\" = 'opening' AND \"amount_minor\" >= 0)",
    );
    expect(migration).not.toContain("personal_expenses_amount_minor_check");
  });

  it("grants only mutable movement columns and never DELETE or a policy rewrite", () => {
    expect(migration).toContain('GRANT UPDATE (\n  "booking_date",\n  "purpose",\n  "counts_in_daily"\n)');
    expect(migration).not.toMatch(/GRANT DELETE/i);
    expect(migration).not.toMatch(/DROP POLICY/i);
  });

  it("splits every statement for the CI database proofs", () => {
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThan(5);
    expect(statements.every((statement) => !statement.includes("--> statement-breakpoint"))).toBe(true);
  });
});
