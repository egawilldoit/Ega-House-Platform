import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../drizzle/0100_money_08_day_start_baselines.sql", import.meta.url),
  "utf8",
);

test("MONEY-08 day-start persistence migration retains policy and baseline versions under owner-scoped RLS", () => {
  assert.ok(migration.includes("UNIQUE (owner_user_id, period_id, version)"));
  assert.ok(migration.includes("UNIQUE (owner_user_id, period_id, date, version)"));
  assert.ok(migration.includes("FOREIGN KEY (owner_user_id, period_id, policy_version_id)"));
  assert.ok(migration.includes("REFERENCES public.money_policy_versions(owner_user_id, period_id, id)"));
  assert.ok(migration.includes("ENABLE ROW LEVEL SECURITY"));
  assert.ok(migration.includes("FORCE ROW LEVEL SECURITY"));
  assert.ok(migration.includes("owner_user_id = (SELECT auth.uid())"));
  assert.ok(migration.includes("mcp_finance_grant_allows('personal_ops.write')"));
});

test("MONEY-08 keeps unknown historical values unavailable instead of backfilling zero", () => {
  assert.ok(migration.includes("availability IN ('available', 'unavailable')"));
  assert.ok(migration.includes("availability = 'unavailable' AND unavailable_reason IS NOT NULL"));
  assert.doesNotMatch(migration, /UPDATE\s+public\.money_day_start_baselines/i);
  assert.match(migration, /cash_minor integer/);
});
