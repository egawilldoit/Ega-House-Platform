import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "../src/auth/actor";
import { getEvidenceReview } from "../src/weekly-review/evidence-review";
import type { DailyCheckinRepository } from "../src/checkins/ports";
import type { ExpenseRepository } from "../src/expenses/ports";
import type { RepositoryResult } from "../src/shared/result";
import type { DailyCheckin } from "@ega/domain/checkins";

const ACTOR = createAuthenticatedActor("owner-evidence");

function checkin(localDate: string, patch: Partial<DailyCheckin> = {}): DailyCheckin {
  return {
    localDate,
    timezone: "Africa/Casablanca",
    outcomes: null,
    personalMinutes: null,
    notes: null,
    overtimeMinutes: null,
    overtimeReason: null,
    routine: null,
    createdAt: `${localDate}T20:00:00.000Z`,
    updatedAt: `${localDate}T20:00:00.000Z`,
    ...patch,
  };
}

function routine(patch: Partial<NonNullable<DailyCheckin["routine"]>>): NonNullable<DailyCheckin["routine"]> {
  return {
    runMinutes: null, runCompleted: null, runSkipped: null,
    chessMinutes: null, sleepHours: null, leisureMinutes: null,
    ...patch,
  };
}

function repos(checkins: DailyCheckin[], moneyTotals = { coffee: 4400, groceries: 1000 }) {
  const checkinRepo: DailyCheckinRepository = {
    async get(_actor, localDate) {
      return { ok: true, value: checkins.find((entry) => entry.localDate === localDate) ?? null };
    },
    async listBetween(_actor, startLocalDate, endLocalDate) {
      return {
        ok: true,
        value: checkins
          .filter((entry) => entry.localDate >= startLocalDate && entry.localDate <= endLocalDate)
          .sort((a, b) => a.localDate.localeCompare(b.localDate)),
      };
    },
    async save(_actor, record) {
      return { ok: true, value: record };
    },
  };
  const expenseRepo = {
    async summarize(): Promise<RepositoryResult<{ totalsByCategory: Partial<Record<string, number>>; countsByCategory: Partial<Record<string, number>>; recordCount: number; truncated: boolean }>> {
      return {
        ok: true,
        value: {
          totalsByCategory: moneyTotals,
          countsByCategory: { coffee: 2, groceries: 1 },
          recordCount: 3,
          truncated: false,
        },
      };
    },
  };
  return { checkins: checkinRepo, expenses: expenseRepo as unknown as ExpenseRepository };
}

const WORK = {
  trackedSeconds: 345600,
  jobSearchSeconds: 54000,
  workTargetMinutes: 5760,
  jobSearchTargetMinutes: 900,
  jobSearchConfigured: true,
};

test("two-week review aggregates work, runs, leisure, overtime and money with coverage", async () => {
  const checkins = [
    checkin("2026-11-09", {
      routine: routine({ runCompleted: true, runMinutes: 30, leisureMinutes: 120, sleepHours: 7 }),
      overtimeMinutes: 60,
      overtimeReason: "Release",
    }),
    checkin("2026-11-10", { routine: routine({ leisureMinutes: 60 }) }),
    checkin("2026-11-11", { routine: routine({ runCompleted: true, runMinutes: 30 }) }),
    checkin("2026-11-12", { overtimeMinutes: 45, overtimeReason: null }),
    checkin("2026-11-13", { routine: routine({ runCompleted: true, runMinutes: 30, leisureMinutes: 0 }) }),
    checkin("2026-11-14", { routine: routine({ runCompleted: true, runMinutes: 30 }) }),
    checkin("2026-11-15", { routine: routine({ runCompleted: true, runMinutes: 30 }) }),
    checkin("2026-11-16", { routine: routine({ runCompleted: true, runMinutes: 30 }) }),
    checkin("2026-11-17", { routine: routine({ runCompleted: false }) }),
  ];
  const result = await getEvidenceReview(ACTOR, repos(checkins), {
    startLocalDate: "2026-11-09",
    endLocalDate: "2026-11-22",
    timezone: "Africa/Casablanca",
    workProgress: async () => WORK,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const data = result.data;
  assert.equal(data.range.totalDays, 14);
  assert.equal(data.work?.trackedSeconds, 345600);
  assert.equal(data.work?.jobSearchSeconds, 54000);
  assert.equal(data.work?.coverage, "canonical-sessions");
  // Six completed runs across two weeks (one false + one day outside? counts in-range only).
  assert.equal(data.runs.sessions, 6);
  assert.equal(data.runs.minutes, 180);
  assert.equal(data.runs.sessionsTarget, 6);
  assert.equal(data.leisure.totalMinutes, 180);
  assert.equal(data.leisure.recordedDays, 3);
  assert.equal(data.leisure.unknownDays, 11);
  assert.equal(data.overtime.evenings, 2);
  assert.equal(data.overtime.reasonedEvenings, 1);
  assert.equal(data.overtime.unreasonedEvenings, 1);
  assert.equal(data.money?.totalMinor, 5400);
  assert.equal(data.money?.coffeeMinor, 4400);
  assert.equal(data.coverage.checkinDays, 9);
  assert.equal(data.coverage.sleepRecordedDays, 1);
  assert.ok(data.suggestions.length <= 3);
  assert.ok(data.suggestions.every((s) => !/12٠/.test(s)));
});

test("review without work provider and without money is honest, not zero-claimed", async () => {
  const result = await getEvidenceReview(ACTOR, repos([]), {
    startLocalDate: "2026-11-09",
    endLocalDate: "2026-11-15",
    timezone: "Africa/Casablanca",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.work, null);
  assert.equal(result.data.money?.totalMinor, 5400);
  assert.equal(result.data.runs.sessions, 0);
  assert.equal(result.data.coverage.checkinDays, 0);
  assert.equal(result.data.leisure.unknownDays, 7);
});

test("review rejects unbounded ranges and invalid identity", async () => {
  assert.equal(
    (await getEvidenceReview(ACTOR, repos([]), { startLocalDate: "2026-11-09", endLocalDate: "2026-12-31", timezone: "Africa/Casablanca" })).ok,
    false,
  );
  assert.equal(
    (await getEvidenceReview(ACTOR, repos([]), { startLocalDate: "2026-11-09", endLocalDate: "2026-11-08", timezone: "Africa/Casablanca" })).ok,
    false,
  );
  assert.equal(
    (await getEvidenceReview(ACTOR, repos([]), { startLocalDate: "2026-11-09", endLocalDate: "2026-11-15", timezone: "Not/AZone" })).ok,
    false,
  );
});
