import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "../src/auth/actor";
import { getExpenseSummary } from "../src/expenses/summary";
import type { ExpenseRepository, ExpenseSummary, ExpenseSummaryWindow } from "../src/expenses/ports";
import type { RepositoryResult } from "../src/shared/result";

const ACTOR = createAuthenticatedActor("owner-expenses-summary");

class FakeRepository implements Partial<ExpenseRepository> {
  summaries: Array<{ window: ExpenseSummaryWindow; value: ExpenseSummary }> = [];
  fail = false;

  async summarize(_actor: unknown, window: ExpenseSummaryWindow): Promise<RepositoryResult<ExpenseSummary>> {
    if (this.fail) return { ok: false, error: { code: "unknown" } };
    const found = this.summaries.find(
      (entry) => entry.window.startUtcIso === window.startUtcIso
        && entry.window.endUtcExclusiveIso === window.endUtcExclusiveIso,
    );
    return { ok: true, value: found?.value ?? { totalsByCategory: {}, countsByCategory: {}, recordCount: 0, truncated: false } };
  }

  static ok(value: ExpenseSummary): ExpenseSummary {
    return value;
  }
}

function seed(repo: FakeRepository, startUtcIso: string, endUtcExclusiveIso: string, value: ExpenseSummary) {
  repo.summaries.push({ window: { startUtcIso, endUtcExclusiveIso }, value });
}

const DAY = { startUtcIso: "2026-11-07T23:00:00.000Z", endUtcExclusiveIso: "2026-11-08T23:00:00.000Z" };
const WEEK = { startUtcIso: "2026-11-01T23:00:00.000Z", endUtcExclusiveIso: "2026-11-08T23:00:00.000Z" };
const MONTH = { startUtcIso: "2026-10-31T23:00:00.000Z", endUtcExclusiveIso: "2026-11-08T23:00:00.000Z" };

test("summary sums integer centimes per owner-local day/week/month with coffee split", async () => {
  const repo = new FakeRepository();
  seed(repo, DAY.startUtcIso, DAY.endUtcExclusiveIso, {
    totalsByCategory: { coffee: 4400, groceries: 1000 },
    countsByCategory: { coffee: 2, groceries: 1 },
    recordCount: 3,
    truncated: false,
  });
  seed(repo, WEEK.startUtcIso, WEEK.endUtcExclusiveIso, {
    totalsByCategory: { coffee: 4400, groceries: 6000 },
    countsByCategory: { coffee: 2, groceries: 3 },
    recordCount: 5,
    truncated: false,
  });
  seed(repo, MONTH.startUtcIso, MONTH.endUtcExclusiveIso, {
    totalsByCategory: { coffee: 6600, groceries: 9000, transport: 500 },
    countsByCategory: { coffee: 3, groceries: 4, transport: 1 },
    recordCount: 8,
    truncated: false,
  });

  const result = await getExpenseSummary(ACTOR, repo as unknown as ExpenseRepository, {
    localDate: "2026-11-08",
    timezone: "Africa/Casablanca",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.day.totalMinor, 5400);
  assert.equal(result.data.day.recordCount, 3);
  assert.equal(result.data.weekToDate.totalMinor, 10400);
  assert.equal(result.data.monthToDate.totalMinor, 16100);
  assert.equal(result.data.coffee.totalMinor, 6600);
  assert.equal(result.data.coffee.recordCount, 3);
});

test("sparse period reports recorded zero with recordCount zero, never inferred spend", async () => {
  const repo = new FakeRepository();
  const result = await getExpenseSummary(ACTOR, repo as unknown as ExpenseRepository, {
    localDate: "2026-11-08",
    timezone: "Africa/Casablanca",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.day.totalMinor, 0);
  assert.equal(result.data.day.recordCount, 0);
  assert.equal(result.data.coffee.totalMinor, 0);
  assert.equal(result.data.coffee.recordCount, 0);
});

test("repository failure is surfaced, never a zero-shaped success", async () => {
  const repo = new FakeRepository();
  repo.fail = true;
  const result = await getExpenseSummary(ACTOR, repo as unknown as ExpenseRepository, {
    localDate: "2026-11-08",
    timezone: "Africa/Casablanca",
  });
  assert.equal(result.ok, false);
});

test("invalid identity is rejected before any read", async () => {
  const repo = new FakeRepository();
  assert.equal(
    (await getExpenseSummary(ACTOR, repo as unknown as ExpenseRepository, { localDate: "2026-11-40", timezone: "Africa/Casablanca" })).ok,
    false,
  );
  assert.equal(
    (await getExpenseSummary(ACTOR, repo as unknown as ExpenseRepository, { localDate: "2026-11-08", timezone: "Not/AZone" })).ok,
    false,
  );
  assert.equal(repo.summaries.length, 0);
});
