import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Structural proof for the reserved MONEY-06 migration. Behavioral proof lives
 * in scripts/db/money-06-obligations-verify.mjs (real Postgres + RLS).
 */

const migration = readFileSync(
  resolve(process.cwd(), "..", "..", "drizzle/0098_money_06_obligations.sql"),
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

describe("MONEY-06 obligations migration", () => {
  it("uses the reserved journal tag, when and idx after 0093", () => {
    const entry = journal.entries.find(
      (item) => item.tag === "0098_money_06_obligations",
    );
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(111);
    expect(entry?.when).toBe(1787880000061);
    expect(entry?.breakpoints).toBe(true);

    const previous = journal.entries.find(
      (item) => item.tag === "0093_money_01_finance_grants",
    );
    expect(previous).toBeDefined();
    expect(entry!.when).toBeGreaterThan(previous!.when);
    // The journal remains strictly ascending around the new entry.
    const index = journal.entries.findIndex(
      (item) => item.tag === "0098_money_06_obligations",
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
    expect(chunks.length).toBeGreaterThan(50);
    for (const chunk of chunks) {
      // A chunk must not smuggle a second top-level statement past the split.
      expect(chunk).not.toMatch(
        /;\s*\n\s*(CREATE|ALTER|GRANT|REVOKE|DROP)\b/,
      );
    }
  });

  it("creates the template and occurrence tables additively", () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "public"."money_obligation_templates"',
    );
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "public"."money_obligations"',
    );
    // The canonical ledger is not redefined or altered destructively.
    expect(migration).not.toMatch(/DROP COLUMN/i);
    expect(migration).not.toMatch(/ALTER TABLE "public"\."personal_expenses"[\s\S]*ADD COLUMN/i);
    expect(migration).not.toContain("CREATE TABLE IF NOT EXISTS \"public\".\"personal_expenses\"");
  });

  it("requires a linked payment or flagged historical evidence for paid", () => {
    expect(migration).toContain('"money_obligations_paid_requires_evidence_check"');
    expect(migration).toContain(
      '"payment_evidence" ->> \'kind\' = \'reconciled_historical_import\'',
    );
    expect(migration).toContain('btrim(COALESCE("payment_evidence" ->> \'reference\', \'\')) <> \'\'');
    // A non-paid occurrence cannot retain a payment link or evidence.
    expect(migration).toContain('"money_obligations_unpaid_has_no_payment_check"');
    expect(migration).toMatch(
      /"state" = 'paid'\s+OR \("payment_expense_id" IS NULL AND "payment_evidence" IS NULL\)/,
    );
  });

  it("allows one full payment per occurrence and one occurrence per payment", () => {
    expect(migration).toContain(
      '"money_obligations_payment_expense_unique"',
    );
    expect(migration).toContain('"money_obligations_template_period_unique"');
    // The link trigger rejects partial, over, foreign, deleted and foreign-owned
    // payments at the persistence boundary.
    expect(migration).toContain("public.enforce_money_obligation_payment_link()");
    expect(migration).toContain(
      "An obligation payment must pay the occurrence in full; partial or overpayment is not supported.",
    );
    expect(migration).toContain(
      "The linked obligation payment belongs to a different owner.",
    );
    expect(migration).toContain(
      "The linked obligation payment is deleted.",
    );
    expect(migration).toContain(
      "The referenced obligation template belongs to a different owner.",
    );
  });

  it("enforces the explicit lifecycle and version guard", () => {
    expect(migration).toContain("public.enforce_money_obligation_update()");
    expect(migration).toContain(
      "(OLD.state = 'pending' AND NEW.state IN ('paid', 'waived', 'cancelled'))",
    );
    expect(migration).toContain(
      "(OLD.state IN ('waived', 'cancelled') AND NEW.state IN ('pending', 'waived', 'cancelled'))",
    );
    expect(migration).toContain("(OLD.state = 'paid' AND NEW.state = 'pending')");
    expect(migration).toContain(
      "Obligation effective date cannot precede the current state date.",
    );
    expect(migration).toContain(
      "A paid obligation is settled by its linked payment; correct the payment through the MONEY-07 path.",
    );
    expect(migration).toContain(
      "Obligation version must increase by exactly one.",
    );
    expect(migration).toContain(
      "Unsupported obligation lifecycle transition from % to %.",
    );
  });

  it("protects a linked payment from generic expense edits and deletion", () => {
    expect(migration).toContain("public.enforce_linked_obligation_payment_guard()");
    expect(migration).toContain(
      '"personal_expenses_obligation_payment_guard"',
    );
    expect(migration).toContain(
      "A ledger payment linked to a paid obligation cannot be edited or deleted; correct the obligation through the MONEY-07 payment path first.",
    );
  });

  it("enables owner-scoped RLS with grant-aware read/write and no DELETE", () => {
    for (const table of ["money_obligation_templates", "money_obligations"]) {
      expect(migration).toContain(
        `ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY`,
      );
      expect(migration).toContain(
        `ALTER TABLE "public"."${table}" FORCE ROW LEVEL SECURITY`,
      );
      expect(migration).toContain(
        `CREATE POLICY "${table}_direct_user_select"`,
      );
      expect(migration).toContain(
        `CREATE POLICY "${table}_direct_user_insert"`,
      );
      expect(migration).toContain(
        `CREATE POLICY "${table}_direct_user_update"`,
      );
    }
    const selectPolicy = migration.slice(
      migration.indexOf('CREATE POLICY "money_obligations_direct_user_select"'),
      migration.indexOf('CREATE POLICY "money_obligations_direct_user_insert"'),
    );
    expect(selectPolicy).toContain(
      "public.mcp_finance_grant_allows('personal_ops.read')",
    );
    const insertPolicy = migration.slice(
      migration.indexOf('CREATE POLICY "money_obligations_direct_user_insert"'),
      migration.indexOf('CREATE POLICY "money_obligations_direct_user_update"'),
    );
    expect(insertPolicy).toContain(
      "public.mcp_finance_grant_allows('personal_ops.write')",
    );
    expect(migration).not.toMatch(/CREATE POLICY "money_obligations[^"]*delete"/i);
    expect(migration).not.toContain("GRANT DELETE");
  });

  it("keeps immutable create identity and owner columns out of UPDATE grants", () => {
    const occurrenceGrant = migration.slice(migration.lastIndexOf("GRANT UPDATE ("));
    expect(occurrenceGrant).toContain('"version"');
    expect(occurrenceGrant).toContain('"payment_expense_id"');
    expect(occurrenceGrant).not.toContain('"owner_user_id"');
    expect(occurrenceGrant).not.toContain('"create_fingerprint"');
    expect(occurrenceGrant).not.toContain('"template_id"');
    expect(occurrenceGrant).not.toContain('"idempotency_key"');
  });
});
