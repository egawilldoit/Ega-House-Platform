import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../drizzle/0100_money_08_day_start_baselines.sql", import.meta.url),
  "utf8",
);

describe("MONEY-08 day-start persistence migration", () => {
  it("retains policy and baseline versions under owner-scoped RLS", () => {
    expect(migration).toContain("UNIQUE (owner_user_id, period_id, version)");
    expect(migration).toContain("UNIQUE (owner_user_id, period_id, date, version)");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("owner_user_id = (SELECT auth.uid())");
    expect(migration).toContain("mcp_finance_grant_allows('personal_ops.write')");
  });

  it("keeps unknown historical values unavailable instead of backfilling zero", () => {
    expect(migration).toContain("availability IN ('available', 'unavailable')");
    expect(migration).toContain("availability = 'unavailable' AND unavailable_reason IS NOT NULL");
    expect(migration).not.toMatch(/UPDATE\s+public\.money_day_start_baselines/i);
    expect(migration).toMatch(/cash_minor integer/);
  });
});
