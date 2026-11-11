import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "..", "..", "drizzle/0096_money_04_movements.sql"),
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
    expect(entry!.when).toBeGreaterThan(previous.when);
  });

  it("additively extends the one ledger instead of creating another store", () => {
    expect(migration).toContain(
      'ALTER TABLE "public"."personal_expenses"',
    );
    expect(migration).not.toMatch(/CREATE TABLE[^;]*personal_(expenses|movements)/i);
    expect(migration).not.toMatch(/CREATE TABLE[^;]*money_(movements|ledger)/i);
    expect(migration).toContain('"kind" varchar(32) NOT NULL DEFAULT \'expense\'');
    expect(migration).toContain('"direction" varchar(3) NOT NULL DEFAULT \'out\'');
    expect(migration).toContain('"counts_in_daily" boolean');
    expect(migration).not.toContain('"counts_in_daily" boolean NOT NULL DEFAULT true');
    expect(migration).toContain('"booking_date" date');
    expect(migration).toContain('"period_id" uuid');
    expect(migration).toContain('"purpose" varchar(16)');
  });

  it("backfills existing expenses as daily-included and keeps their booking day", () => {
    const backfill = migration.slice(
      migration.indexOf('UPDATE "public"."personal_expenses" AS e'),
      migration.indexOf("ALTER TABLE \"public\".\"personal_expenses\"\n  ALTER COLUMN \"booking_date\" SET NOT NULL"),
    );
    expect(backfill).toContain('SET "booking_date" = (');
    expect(backfill).toContain('AT TIME ZONE COALESCE(');
    expect(backfill).toContain('"public"."user_time_context"');
    expect(migration).toContain('ALTER COLUMN "booking_date" SET NOT NULL');
    // Existing rows inherit the column default true; no flag is invented later.
    expect(migration).not.toMatch(/UPDATE[^;]*counts_in_daily\s*=\s*false/i);
  });

  it("allows non-expense rows without fictional category or need/want", () => {
    expect(migration).toContain('ALTER COLUMN "category" DROP NOT NULL');
    expect(migration).toContain('ALTER COLUMN "need_vs_want" DROP NOT NULL');
    const shape = migration.slice(
      migration.indexOf('ADD CONSTRAINT "personal_expenses_kind_shape_check"'),
    );
    expect(shape).toContain('"kind" = \'expense\'');
    expect(shape).toContain('"kind" IN (\'income\', \'opening\')');
    expect(shape).toContain('"kind" = \'savings_transfer\'');
    expect(shape).toContain('"kind" = \'reconciliation_adjustment\'');
    expect(shape).toContain('"category" IS NULL');
    expect(shape).toContain('"purpose" IS NULL');
  });

  it("adds the owner booking-date index and keeps period ownership in MONEY-03", () => {
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "personal_expenses_owner_booking_date_idx"',
    );
    expect(migration).toContain("to_regclass('public.money_periods')");
    expect(migration).toContain('FOREIGN KEY ("period_id") REFERENCES "public"."money_periods"("id")');
    expect(migration).not.toMatch(/CREATE TABLE[^;]*money_periods/i);
  });

  it("keeps kind and direction immutable and grants only mutable movement columns", () => {
    const guard = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.enforce_personal_expense_update()"),
    );
    expect(guard).toContain("NEW.kind IS DISTINCT FROM OLD.kind");
    expect(guard).toContain("NEW.direction IS DISTINCT FROM OLD.direction");
    expect(guard).toContain("NEW.version IS DISTINCT FROM OLD.version + 1");
    expect(migration).toContain('GRANT UPDATE (\n  "booking_date",\n  "purpose",\n  "counts_in_daily"\n)');
    expect(migration).not.toMatch(/GRANT DELETE/i);
    expect(migration).not.toMatch(/DROP POLICY/i);
  });

  it("falls back to UTC booking dates and kind-aware daily defaults only when omitted", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fill_personal_expense_movement_fields()");
    expect(migration).toContain('IF NEW."counts_in_daily" IS NULL THEN');
    expect(migration).toContain('(NEW."kind" = \'expense\')');
    expect(migration).toContain('IF NEW."booking_date" IS NULL THEN');
    expect(migration).toContain('(NEW."occurred_at" AT TIME ZONE \'UTC\')::date');
  });

  it("splits every statement for the CI database proofs", () => {
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThan(10);
    expect(statements.every((statement) => !statement.includes("--> statement-breakpoint"))).toBe(true);
  });
});
