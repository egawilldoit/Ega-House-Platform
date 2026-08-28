import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor, type AuthenticatedActor, type RepositoryResult } from "../src/index";
import { getFrictionRadarReadModel, STALE_THRESHOLD_DAYS } from "../src/friction/stale-blocked-signals";
import type { FrictionGoalRow, FrictionRepository, FrictionTaskRow } from "../src/friction/ports";
import { FRICTION_STALE_THRESHOLD_DAYS } from "@ega/domain/friction";

const ACTOR = createAuthenticatedActor("user-123");
const NOW = new Date("2026-08-27T12:00:00.000Z");

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

function ago(days: number, extraMs = 0): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000 - extraMs).toISOString();
}

class FakeFrictionRepository implements FrictionRepository {
  tasks: FrictionTaskRow[] = [];
  goals: FrictionGoalRow[] = [];
  calls: Array<{ method: string; actor: string }> = [];
  tasksError: RepositoryResult<FrictionTaskRow[]> | null = null;
  goalsError: RepositoryResult<FrictionGoalRow[]> | null = null;
  constructor(tasks: FrictionTaskRow[] = [], goals: FrictionGoalRow[] = []) {
    this.tasks = tasks;
    this.goals = goals;
  }
  async listTasks(actor: AuthenticatedActor) {
    this.calls.push({ method: "listTasks", actor: actor.userId });
    if (this.tasksError) return this.tasksError;
    return ok(this.tasks);
  }
  async listGoals(actor: AuthenticatedActor) {
    this.calls.push({ method: "listGoals", actor: actor.userId });
    if (this.goalsError) return this.goalsError;
    return ok(this.goals);
  }
}

test("blocked active tasks produce signal with id/title/blockedReason/age", async () => {
  const repo = new FakeFrictionRepository(
    [
      {
        id: "task-blocked-1",
        title: "Blocked with reason",
        blockedReason: "Waiting for review",
        status: "blocked",
        updatedAt: ago(3),
        projectId: "proj-1",
        goalId: "goal-1",
        archivedAt: null,
      },
      {
        id: "task-blocked-2",
        title: "Blocked no reason",
        blockedReason: null,
        status: "blocked",
        updatedAt: ago(10),
        projectId: "proj-1",
        goalId: null,
        archivedAt: null,
      },
    ],
    [],
  );

  const result = await getFrictionRadarReadModel(ACTOR, repo, { now: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.blocked.length, 2);
  // blocked includes age days computed deterministically
  const first = result.data.blocked.find((b) => b.id === "task-blocked-1");
  const second = result.data.blocked.find((b) => b.id === "task-blocked-2");
  assert.equal(first?.blockedReason, "Waiting for review");
  assert.equal(first?.ageDays, 3);
  assert.equal(first?.title, "Blocked with reason");
  assert.equal(second?.blockedReason, null);
  assert.equal(second?.ageDays, 10);
  // blocked sorted oldest first (higher ageDays)
  assert.equal(result.data.blocked[0].id, "task-blocked-2");
  assert.equal(result.data.blocked[1].id, "task-blocked-1");
  // owner-scoped
  assert.deepEqual(repo.calls.map((c) => c.actor), ["user-123", "user-123"]);
});

test("stale threshold 7 days: 6 days not stale, 7 days stale, 8 days stale", async () => {
  const repo = new FakeFrictionRepository(
    [
      { id: "fresh", title: "Fresh", blockedReason: null, status: "todo", updatedAt: ago(6), projectId: "p1", goalId: null, archivedAt: null },
      { id: "exact", title: "Exact", blockedReason: null, status: "todo", updatedAt: ago(7), projectId: "p1", goalId: null, archivedAt: null },
      { id: "old", title: "Old", blockedReason: null, status: "todo", updatedAt: ago(8), projectId: "p1", goalId: null, archivedAt: null },
    ],
    [
      { id: "goal-fresh", title: "Goal Fresh", status: "active", updatedAt: ago(6), projectId: "p1" },
      { id: "goal-old", title: "Goal Old", status: "active", updatedAt: ago(10), projectId: "p1" },
    ],
  );

  const result = await getFrictionRadarReadModel(ACTOR, repo, { now: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.thresholdDays, 7);
  assert.equal(result.data.thresholdDays, FRICTION_STALE_THRESHOLD_DAYS);
  assert.equal(result.data.thresholdDays, STALE_THRESHOLD_DAYS);
  assert.equal(result.data.staleTasks.length, 2);
  assert.equal(result.data.staleTasks.some((t) => t.id === "fresh"), false);
  assert.equal(result.data.staleTasks.some((t) => t.id === "exact"), true);
  assert.equal(result.data.staleTasks.some((t) => t.id === "old"), true);
  // goals
  assert.equal(result.data.staleGoals.length, 1);
  assert.equal(result.data.staleGoals[0].id, "goal-old");
  assert.equal(result.data.staleGoals[0].ageDays, 10);
});

test("archived and completed work excluded from all signals", async () => {
  const repo = new FakeFrictionRepository(
    [
      // blocked but archived -> excluded
      { id: "blocked-archived", title: "Blocked archived", blockedReason: "x", status: "blocked", updatedAt: ago(10), projectId: "p1", goalId: null, archivedAt: ago(1) },
      // stale but completed -> excluded
      { id: "stale-done", title: "Done stale", blockedReason: null, status: "done", updatedAt: ago(10), projectId: "p1", goalId: null, archivedAt: null },
      // stale but archived -> excluded
      { id: "stale-archived", title: "Archived stale", blockedReason: null, status: "todo", updatedAt: ago(10), projectId: "p1", goalId: null, archivedAt: ago(1) },
      // valid stale active should remain
      { id: "valid", title: "Valid stale", blockedReason: null, status: "todo", updatedAt: ago(10), projectId: "p1", goalId: null, archivedAt: null },
    ],
    [
      { id: "goal-archived", title: "Archived goal", status: "archived", updatedAt: ago(10), projectId: "p1" },
      { id: "goal-done", title: "Done goal", status: "done", updatedAt: ago(10), projectId: "p1" },
      { id: "goal-valid", title: "Valid goal", status: "active", updatedAt: ago(10), projectId: "p1" },
    ],
  );

  const result = await getFrictionRadarReadModel(ACTOR, repo, { now: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.blocked.length, 0);
  assert.equal(result.data.staleTasks.length, 1);
  assert.equal(result.data.staleTasks[0].id, "valid");
  assert.equal(result.data.staleGoals.length, 1);
  assert.equal(result.data.staleGoals[0].id, "goal-valid");
});

test("empty state returns empty arrays with threshold and generatedAt", async () => {
  const repo = new FakeFrictionRepository([], []);
  const result = await getFrictionRadarReadModel(ACTOR, repo, { now: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.blocked, []);
  assert.deepEqual(result.data.staleTasks, []);
  assert.deepEqual(result.data.staleGoals, []);
  assert.equal(result.data.thresholdDays, 7);
  assert.equal(result.data.generatedAt, NOW.toISOString());
  assert.equal(result.data.ok, true);
});

test("partial-data: tasks with invalid updatedAt are skipped, not crashed", async () => {
  const repo = new FakeFrictionRepository(
    [
      { id: "bad-date", title: "Bad", blockedReason: null, status: "todo", updatedAt: "not-a-date", projectId: "p1", goalId: null, archivedAt: null },
      { id: "good", title: "Good", blockedReason: null, status: "todo", updatedAt: ago(10), projectId: "p1", goalId: null, archivedAt: null },
    ],
    [],
  );
  const result = await getFrictionRadarReadModel(ACTOR, repo, { now: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.staleTasks.length, 1);
  assert.equal(result.data.staleTasks[0].id, "good");
});

test("owner-scoped: repository receives authenticated actor id", async () => {
  const repo = new FakeFrictionRepository([], []);
  const differentActor = createAuthenticatedActor("user-999");
  await getFrictionRadarReadModel(differentActor, repo, { now: NOW });
  assert.equal(repo.calls[0].actor, "user-999");
  assert.equal(repo.calls[1].actor, "user-999");
});

test("failure in repository propagates sanitized error", async () => {
  const repo = new FakeFrictionRepository([], []);
  repo.tasksError = { ok: false, error: { code: "unknown" } };
  const result = await getFrictionRadarReadModel(ACTOR, repo, { now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.errorMessage, /Unable to load friction/);
});

test("web and mobile same semantics: threshold and signals derive from shared read model, not UI recalculation", async () => {
  // Both transports should consume same DTO shape and threshold constant.
  // This test verifies the contract and domain threshold are identical,
  // ensuring web and mobile render same semantics without local recalculation.
  const { FRICTION_STALE_THRESHOLD_DAYS: CONTRACT_THRESHOLD } = await import("@ega/contracts/friction");
  const { FRICTION_STALE_THRESHOLD_DAYS: DOMAIN_THRESHOLD } = await import("@ega/domain");
  assert.equal(CONTRACT_THRESHOLD, DOMAIN_THRESHOLD);
  assert.equal(STALE_THRESHOLD_DAYS, DOMAIN_THRESHOLD);

  const repo = new FakeFrictionRepository(
    [{ id: "t1", title: "Task", blockedReason: null, status: "blocked", updatedAt: ago(9), projectId: "p1", goalId: null, archivedAt: null }],
    [{ id: "g1", title: "Goal", status: "active", updatedAt: ago(9), projectId: "p1" }],
  );
  const result = await getFrictionRadarReadModel(ACTOR, repo, { now: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Age is derived in read model, not by UI.
  assert.equal(result.data.blocked[0].ageDays, 9);
  assert.equal(result.data.staleTasks[0].ageDays, 9);
  assert.equal(result.data.staleGoals[0].ageDays, 9);
  // DTO shape matches contract (would be same for web page component and mobile FrictionRadarView)
  assert.equal(typeof result.data.blocked[0].blockedReason, "object"); // nullable check
  assert.equal(result.data.blocked[0].id, "t1");
});
