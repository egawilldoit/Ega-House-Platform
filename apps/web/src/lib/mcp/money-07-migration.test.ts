import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Structural proof for the MONEY-07 migration. Behavioral proof lives in
 * scripts/db/money-07-payments-verify.mjs (real Postgres + RLS).
 */

const migration = readFileSync(
  resolve(process.cwd(), "..", "..", "drizzle/0099_money_07_obligation_payments.sql"),
  "utf8",
);

const journal = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "..", "..", "drizzle/meta/_journal.json"),
    "utf8",
  ),
) as {
  entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
};

describe("MONEY-07 obligation payments migration", () => {
  it("uses the reserved journal tag, when and idx after 0098", () => {
    const entry = journal.entries.find(
      (item) => item.tag === "0099_money_07_obligation_payments",
    );
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(112);
    expect(entry?.when).toBe(1787880000062);
    expect(entry?.breakpoints).toBe(true);

    const previous = journal.entries.find(
      (item) => item.tag === "0098_money_06_obligations",
    );
    expect(previous).toBeDefined();
    expect(entry!.when).toBeGreaterThan(previous!.when);

    const index = journal.entries.findIndex(
      (item) => item.tag === "0099_money_07_obligation_payments",
    );
    expect(index).toBeGreaterThan(0);
    expect(journal.entries[index].when).toBeGreaterThan(
      journal.entries[index - 1].when,
    );
  });

  it("separates every statement with a breakpoint", () => {
    const chunks = migration
      .split("--> statement-breakpoint")
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);
    expect(chunks.length).toBeGreaterThan(20);
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(
        /;\s*\n\s*(CREATE|ALTER|GRANT|REVOKE|DROP)\b/,
      );
    }
  });

  it("never edits an applied migration and never redefines the ledger", () => {
    expect(migration).not.toMatch(/DROP COLUMN/i);
    expect(migration).not.toContain(
      'CREATE TABLE IF NOT EXISTS "public"."personal_expenses"',
    );
    expect(migration).not.toMatch(
      /ALTER TABLE "public"\."personal_expenses"[\s\S]*DROP COLUMN/i,
    );
  });

  it("adds the payment operation identity to the occurrence", () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "payment_operation_id"');
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "payment_revision_operation_id"',
    );
    expect(migration).toContain('"money_obligations_owner_payment_operation_unique"');
    // One operation settles at most one occurrence.
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "money_obligations_owner_payment_operation_unique"[\s\S]*USING btree \("owner_user_id", "payment_operation_id"\)/,
    );
  });

  it("installs the three atomic payment functions as SECURITY DEFINER", () => {
    for (const name of [
      "money_pay_obligation",
      "money_correct_obligation_payment",
      "money_undo_obligation_payment",
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
    }
    expect(migration.match(/SECURITY DEFINER/g)?.length).toBeGreaterThanOrEqual(4);
    // The owner always comes from the verified session.
    expect(migration).toContain("v_owner uuid := auth.uid();");
    expect(migration).toContain(
      "public.mcp_finance_grant_allows('personal_ops.write')",
    );
  });

  it("locks the occurrence, checks the version and links one payment", () => {
    const pay = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.money_pay_obligation("),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.money_correct_obligation_payment("),
    );
    expect(pay).toContain("FOR UPDATE;");
    expect(pay).toContain("v_occurrence.\"version\" <> p_expected_version");
    expect(pay).toContain("v_occurrence.\"state\" <> 'pending'");
    expect(pay).toContain('INSERT INTO public.personal_expenses');
    expect(pay).toContain("'expense', 'out'");
    expect(pay).toContain("v_occurrence.\"amount_minor\"");
    expect(pay).toContain('"payment_operation_id" = p_operation_id');
    // A retry of the same operation replays the original result.
    expect(pay).toContain("'outcome', 'replayed'");
  });

  it("keeps the linked-payment guard closed for generic expense edits", () => {
    expect(migration).toContain("public.enforce_linked_obligation_payment_guard()");
    expect(migration).toContain(
      "A ledger payment linked to a paid obligation cannot be edited or deleted; correct the obligation through the MONEY-07 payment path first.",
    );
    // The 0098 guard is replaced in place, never edited in its own file.
    expect(migration).toContain("public.money_obligation_payment_path_active()");
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.enforce_linked_obligation_payment_guard()",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.enforce_money_obligation_update()",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.enforce_money_obligation_payment_link()",
    );
  });

  it("defers the coherence check to commit time", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.enforce_money_obligation_payment_coherence()",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.enforce_linked_expense_payment_coherence()",
    );
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain(
      "An obligation payment must pay the occurrence in full; partial or overpayment is not supported.",
    );
  });

  it("revokes public execution and grants the authenticated role", () => {
    for (const name of [
      "money_pay_obligation",
      "money_correct_obligation_payment",
      "money_undo_obligation_payment",
    ]) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.${name}(`,
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${name}(`,
      );
    }
    expect(migration).not.toContain("TO anon;");
  });
});
