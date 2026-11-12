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

test("MONEY-08 setup remains unavailable until explicit rebase completes setup", () => {
  assert.match(migration, /day_start_setup_completed boolean NOT NULL DEFAULT false/);
  assert.match(migration, /IF NOT v_period\.day_start_setup_completed THEN/);
  assert.match(migration, /day_start_setup_completed = true/);
  assert.match(migration, /'initial_setup_incomplete'/);
  assert.match(migration, /money_calculate_day_start_baseline\(p_period_id, v_period\.active_date, true\)/);
});

test("MONEY-08 write RPCs require explicit MCP finance write grant", () => {
  const grants = readFileSync(new URL("../../../drizzle/0102_money_08_baseline_write_grants.sql", import.meta.url), "utf8");
  assert.equal((grants.match(/mcp_finance_grant_allows\('personal_ops\.write'\)/g) ?? []).length, 2);
  assert.match(grants, /money_ensure_day_start_baseline[\s\S]*?Finance write grant required/);
  assert.match(grants, /money_rebase_day_start_baseline[\s\S]*?Finance write grant required/);
  assert.match(grants, /auth\.uid\(\) IS NULL/);
  assert.match(grants, /ERRCODE = '42501'/);
});
