import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor, type AuthenticatedActor } from "../src/auth/actor";
import type { RepositoryResult } from "../src/shared/result";
import type { TimeContextRepository } from "../src/shared/time-context";
import type { ExecutionEvidenceRepository, ExecutionEvidenceSessionRow, ExecutionEvidenceWindow } from "../src/shared/execution-evidence";
import { getWeeklyReviewReadModel } from "../src/weekly-review/read-model";
import type { WeeklyReviewRepository, WeeklyReviewRow, WeeklyReviewTaskRepository, WeeklyReviewTaskActivityRow } from "../src/weekly-review/ports";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

class FakeTimeContextRepo implements TimeContextRepository {
  constructor(private stored: string | null = "UTC") {}
  async getTimezone(): Promise<RepositoryResult<string | null>> { return ok(this.stored); }
  async setTimezone(_actor: AuthenticatedActor, tz: string): Promise<RepositoryResult<string>> { this.stored = tz; return ok(tz); }
}

class FakeEvidenceRepo implements ExecutionEvidenceRepository {
  async listSessionsForWindow(): Promise<RepositoryResult<ExecutionEvidenceSessionRow[]>> { return ok([]); }
}

class FakeTasksRepo implements WeeklyReviewTaskRepository {
  async countTasksCreatedForWindow(): Promise<RepositoryResult<number>> { return ok(0); }
  async listGoalsTouchedForWindow(): Promise<RepositoryResult<Array<{ status: string }>>> { return ok([]); }
  async listBlockedTasks(): Promise<RepositoryResult<Array<{ id: string; title: string; blockedReason: string | null; updatedAt: string }>>> { return ok([]); }
  async listCompletedTasksForWindow(): Promise<RepositoryResult<WeeklyReviewTaskActivityRow[]>> { return ok([]); }
  async listCarriedTasksForWindow(): Promise<RepositoryResult<WeeklyReviewTaskActivityRow[]>> { return ok([]); }
  async listBlockedTasksForWindow(): Promise<RepositoryResult<WeeklyReviewTaskActivityRow[]>> { return ok([]); }
}

/**
 * Strict repository mimics the fixed SupabaseWeeklyReviewRepository:
 * getPreviousReview does exact W-7 equality, not lt newest.
 */
class StrictFakeReviewRepo implements WeeklyReviewRepository {
  private store = new Map<string, WeeklyReviewRow>();
  constructor(rows: WeeklyReviewRow[]) {
    for (const r of rows) this.store.set(r.weekStart, r);
  }
  async getSavedReview(): Promise<RepositoryResult<WeeklyReviewRow | null>> { return ok(null); }
  async listPastReviews(): Promise<RepositoryResult<WeeklyReviewRow[]>> { return ok(Array.from(this.store.values())); }
  async getPreviousReview(_actor: AuthenticatedActor, weekStart: string): Promise<RepositoryResult<WeeklyReviewRow | null>> {
    const d = new Date(`${weekStart}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return ok(null);
    d.setUTCDate(d.getUTCDate() - 7);
    const prevStart = d.toISOString().slice(0, 10);
    return ok(this.store.get(prevStart) ?? null);
  }
}

const ACTOR = createAuthenticatedActor("user-123");

function makeRow(weekStart: string): WeeklyReviewRow {
  const end = new Date(`${weekStart}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    id: `id-${weekStart}`,
    weekStart,
    weekEnd: end.toISOString().slice(0, 10),
    summary: `summary-${weekStart}`,
    wins: null,
    blockers: null,
    nextSteps: null,
    createdAt: `${weekStart}T12:00:00.000Z`,
    updatedAt: null,
    officialEmailStatus: null,
    officialEmailSentAt: null,
  };
}

test("previous-week strict adjacency: current W exists exact W-1 exists → return W-1", async () => {
  const w = "2026-02-16";
  const w1 = "2026-02-09";
  const repo = new StrictFakeReviewRepo([makeRow(w), makeRow(w1)]);
  const result = await getWeeklyReviewReadModel(
    ACTOR,
    { timeContext: new FakeTimeContextRepo("UTC"), weeklyReview: repo, weeklyTasks: new FakeTasksRepo(), executionEvidence: new FakeEvidenceRepo() },
    { weekOf: w },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // previousReview is used in draft and also reflects strictly fetched previous
  // The read model's comparison previousWindow is W-1, and previousReview should be W-1
  // Verify via internal: generatedDraft includes previous context? Check that previous exists
  // The read model exposes previous via draft previousReview; we can check evidence that W-1 was fetched
  // Directly verify repository strict returns W-1 row
  const prev = await repo.getPreviousReview(ACTOR, w);
  assert.equal(prev.ok && prev.value?.weekStart, w1);
  // And read model should have succeeded with W-1 week window
  assert.equal(result.data.comparison.previousWindow.weekStart, w1);
});

test("previous-week strict: W-1 missing W-2 exists → previous review = null (never newest arbitrary)", async () => {
  const w = "2026-02-16";
  const w2 = "2026-02-02"; // W-2, missing W-1 (2026-02-09)
  const repo = new StrictFakeReviewRepo([makeRow(w), makeRow(w2)]);
  const result = await getWeeklyReviewReadModel(
    ACTOR,
    { timeContext: new FakeTimeContextRepo("UTC"), weeklyReview: repo, weeklyTasks: new FakeTasksRepo(), executionEvidence: new FakeEvidenceRepo() },
    { weekOf: w },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const prev = await repo.getPreviousReview(ACTOR, w);
  assert.equal(prev.ok, true);
  if (!prev.ok) return;
  assert.equal(prev.value, null, "strict eq should return null when W-1 missing, not W-2");
  // Ensure read model also reflects null previous (draft will say no previous)
  assert.match(result.data.generatedDraft.summary, /No previous weekly review was available/);
});

test("previous-week strict: newest arbitrary older review not returned when multiple older exist", async () => {
  const w = "2026-02-16";
  const w2 = "2026-02-02";
  const w3 = "2026-01-26";
  const repo = new StrictFakeReviewRepo([makeRow(w), makeRow(w2), makeRow(w3)]);
  const prev = await repo.getPreviousReview(ACTOR, w);
  assert.equal(prev.ok, true);
  if (!prev.ok) return;
  assert.equal(prev.value, null, "must not return W-2 even though it is newest older when W-1 missing");
});

test("previous-week strict: exact W-1 with multiple older still returns W-1 not W-2", async () => {
  const w = "2026-02-16";
  const w1 = "2026-02-09";
  const w2 = "2026-02-02";
  const repo = new StrictFakeReviewRepo([makeRow(w), makeRow(w1), makeRow(w2)]);
  const prev = await repo.getPreviousReview(ACTOR, w);
  assert.equal(prev.ok && prev.value?.weekStart, w1);
});
