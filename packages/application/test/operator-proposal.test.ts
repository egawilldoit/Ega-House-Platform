import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOperatorProposal,
  buildOperatorSnapshot,
  createAuthenticatedActor,
  getOperatorProposal,
  getOperatorProposalHashInput,
  OPERATOR_PROPOSAL_MAX_ESTIMATE_MINUTES,
  OPERATOR_PROPOSAL_MAX_TASKS,
  OPERATOR_PROPOSAL_MIN_TASKS,
  OPERATOR_PROPOSAL_VERSION,
  type AuthenticatedActor,
  type OperatorProposal,
  type RepositoryResult,
  type TodayReadPort,
  type TodaySourceTask,
} from "../src/index";
import { buildTodayPlan } from "../src/today/plan";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

function task(overrides: Partial<TodaySourceTask> & { id: string }): TodaySourceTask {
  return {
    title: `Task ${overrides.id}`,
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    focusRank: null,
    plannedForDate: "2026-08-10",
    updatedAt: "2026-08-10T08:00:00.000Z",
    completedAt: null,
    projectName: "Apollo",
    projectSlug: "apollo",
    goalTitle: "Launch",
    ...overrides,
  };
}

const TODAY = "2026-08-10";

function snapshotFromRows(input: {
  selected?: TodaySourceTask[];
  pinned?: TodaySourceTask[];
  inProgress?: TodaySourceTask[];
  activeTimer?: { sessionId: string; taskId: string } | null;
  trackedTodaySeconds?: number;
}) {
  const plan = buildTodayPlan({
    today: TODAY,
    selectedRows: input.selected ?? [],
    pinnedRows: input.pinned ?? [],
    inProgressRows: input.inProgress ?? [],
    activeTimer: input.activeTimer ?? null,
    trackedTodaySeconds: input.trackedTodaySeconds ?? 0,
  });
  return buildOperatorSnapshot({ plan });
}

// ---------------------------------------------------------------------------
// Bounded set 3-6 when enough candidates exist
// ---------------------------------------------------------------------------

test("Proposal bounded set: 10 candidates yields 3-6 tasks (max 6)", () => {
  const selected = Array.from({ length: 10 }, (_, i) =>
    task({ id: `t-${String(i).padStart(2, "0")}`, plannedForDate: TODAY, estimateMinutes: 20, updatedAt: `2026-08-10T08:0${i}:00.000Z` }),
  );
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, timezone: "UTC", now: new Date("2026-08-10T12:00:00.000Z") });
  assert.equal(proposal.tasks.length >= OPERATOR_PROPOSAL_MIN_TASKS, true);
  assert.equal(proposal.tasks.length <= OPERATOR_PROPOSAL_MAX_TASKS, true);
  assert.equal(proposal.candidateIds.length, proposal.tasks.length);
  assert.deepEqual(proposal.candidateIds, proposal.tasks.map((t) => t.id));
  // Stable ordered set: candidateIds order equals tasks order
  assert.equal(proposal.version, OPERATOR_PROPOSAL_VERSION);
});

test("Proposal exactly caps at 6 when 20 candidates and load permits", () => {
  const selected = Array.from({ length: 20 }, (_, i) =>
    task({ id: `cap-${String(i).padStart(2, "0")}`, plannedForDate: TODAY, estimateMinutes: 10, updatedAt: "2026-08-10T08:00:00.000Z" }),
  );
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(proposal.tasks.length, 6);
  assert.equal(proposal.remainingCandidates, proposal.sourceEvidence.totalCandidatesConsidered - 6);
});

test("Proposal respects estimate load: many large tasks trimmed after MIN", () => {
  // Each 120m -> 3 tasks = 360 fits, 4th would exceed 360
  const selected = Array.from({ length: 10 }, (_, i) =>
    task({ id: `big-${String(i).padStart(2, "0")}`, plannedForDate: TODAY, estimateMinutes: 120, priority: "medium", updatedAt: "2026-08-10T08:00:00.000Z" }),
  );
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  // Should be exactly MIN (3) due load cap, not 6
  assert.equal(proposal.tasks.length, OPERATOR_PROPOSAL_MIN_TASKS);
  assert.equal(proposal.totalEstimateMinutes, 360);
  // Even with load cap, we still have deterministic ordering
  assert.equal(proposal.candidateIds.length, 3);
});

// ---------------------------------------------------------------------------
// Exclusions: completed/archived/blocked
// ---------------------------------------------------------------------------

test("Proposal excludes completed, blocked, and canceled tasks", () => {
  const selected: TodaySourceTask[] = [
    task({ id: "todo-1", plannedForDate: TODAY }),
    task({ id: "done-1", status: "done", completedAt: "2026-08-10T06:00:00Z", plannedForDate: TODAY }),
    task({ id: "blocked-1", status: "blocked", blockedReason: "waiting", plannedForDate: TODAY }),
    task({ id: "canceled-1", status: "canceled", plannedForDate: TODAY }),
    task({ id: "todo-2", plannedForDate: TODAY }),
    task({ id: "todo-3", plannedForDate: TODAY }),
    task({ id: "todo-4", plannedForDate: TODAY }),
  ];
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  const ids = proposal.candidateIds;
  assert.equal(ids.includes("done-1"), false);
  assert.equal(ids.includes("blocked-1"), false);
  assert.equal(ids.includes("canceled-1"), false);
  assert.equal(ids.includes("todo-1"), true);
  // Also not counted in totalCandidatesConsidered? It should exclude them
  assert.equal(proposal.sourceEvidence.totalCandidatesConsidered, 4); // only 4 todos
});

test("Proposal excludes archived-like tasks via status and defensively", () => {
  const selected: TodaySourceTask[] = [
    task({ id: "a1", plannedForDate: TODAY }),
    task({ id: "arch-1", status: "done" as unknown as string, plannedForDate: TODAY }), // treated as completed
  ];
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(proposal.candidateIds.includes("arch-1"), false);
});

// ---------------------------------------------------------------------------
// Ranking: priority, due, focusRank, estimate, Timer, in-progress
// ---------------------------------------------------------------------------

test("Proposal ranking: active Timer task first", () => {
  const selected = [
    task({ id: "t1", plannedForDate: TODAY, priority: "low", updatedAt: "2026-08-10T08:00:00.000Z" }),
    task({ id: "t2", plannedForDate: TODAY, priority: "low", updatedAt: "2026-08-10T08:00:00.000Z" }),
  ];
  const snap = snapshotFromRows({
    selected,
    activeTimer: { sessionId: "s1", taskId: "t2" },
  });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(proposal.tasks[0].id, "t2");
  assert.ok(proposal.tasks[0].reasons.includes("Active timer"));
  assert.equal(proposal.tasks[0].evidence.hasActiveTimer, true);
});

test("Proposal ranking: in_progress before todo", () => {
  const selected = [
    task({ id: "todo-1", status: "todo", plannedForDate: TODAY, priority: "medium", updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "ip-1", status: "in_progress", plannedForDate: TODAY, priority: "medium", updatedAt: "2026-08-10T08:00:00Z" }),
  ];
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(proposal.tasks[0].id, "ip-1");
  assert.ok(proposal.tasks[0].reasons.includes("In progress"));
});

test("Proposal ranking: priority urgent > high > medium > low", () => {
  const selected = [
    task({ id: "low", priority: "low", plannedForDate: TODAY, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "urgent", priority: "urgent", plannedForDate: TODAY, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "high", priority: "high", plannedForDate: TODAY, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "medium", priority: "medium", plannedForDate: TODAY, updatedAt: "2026-08-10T08:00:00Z" }),
  ];
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  const order = proposal.tasks.map((t) => t.id);
  assert.deepEqual(order, ["urgent", "high", "medium", "low"]);
});

test("Proposal ranking: due bucket overdue > today > soon > scheduled/none", () => {
  const selected = [
    task({ id: "none", dueDate: null, plannedForDate: TODAY, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "soon", dueDate: "2026-08-12", plannedForDate: TODAY, updatedAt: "2026-08-10T08:00:00Z" }), // soon (within 7)
    task({ id: "today", dueDate: TODAY, plannedForDate: TODAY, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "overdue", dueDate: "2026-08-01", plannedForDate: TODAY, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "scheduled", dueDate: "2026-09-01", plannedForDate: TODAY, updatedAt: "2026-08-10T08:00:00Z" }),
  ];
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  const order = proposal.tasks.map((t) => t.id);
  assert.deepEqual(order, ["overdue", "today", "soon", "scheduled", "none"]);
  // Verify reasons
  const overdueTask = proposal.tasks.find((t) => t.id === "overdue")!;
  assert.ok(overdueTask.reasons.includes("Overdue"));
  const dueTodayTask = proposal.tasks.find((t) => t.id === "today")!;
  assert.ok(dueTodayTask.reasons.includes("Due today"));
});

test("Proposal ranking: focusRank, isPlannedForToday, estimate, deterministic id tie-break", () => {
  const selected = [
    task({ id: "b", priority: "medium", focusRank: 2, plannedForDate: TODAY, estimateMinutes: 60, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "a", priority: "medium", focusRank: 1, plannedForDate: TODAY, estimateMinutes: 60, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "c", priority: "medium", focusRank: null, plannedForDate: TODAY, estimateMinutes: 30, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "d", priority: "medium", focusRank: null, plannedForDate: null, estimateMinutes: 30, updatedAt: "2026-08-10T08:00:00Z" }),
  ];
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  // isPlannedForToday true before false, then focusRank, then estimate
  // a (rank1, planned) -> b (rank2, planned) -> c (null, planned, est 30) -> d (null, not planned)
  // Actually c has smaller estimate than a/b but focusRank wins before estimate
  const order = proposal.tasks.map((t) => t.id);
  assert.deepEqual(order.slice(0, 4), ["a", "b", "c", "d"]);
  assert.ok(proposal.tasks.find((t) => t.id === "a")!.reasons.some((r) => r.includes("Pinned")));
});

test("Proposal ranking: estimate smaller first when other keys equal", () => {
  const selected = [
    task({ id: "large", priority: "medium", plannedForDate: TODAY, estimateMinutes: 120, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "small", priority: "medium", plannedForDate: TODAY, estimateMinutes: 15, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "medium", priority: "medium", plannedForDate: TODAY, estimateMinutes: 60, updatedAt: "2026-08-10T08:00:00Z" }),
  ];
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  assert.deepEqual(proposal.tasks.map((t) => t.id), ["small", "medium", "large"]);
});

test("Proposal ranking is deterministic regardless of input order", () => {
  const base = [
    task({ id: "t3", priority: "high", focusRank: 3, dueDate: "2026-08-10", plannedForDate: TODAY, estimateMinutes: 30, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "t1", priority: "urgent", focusRank: 1, dueDate: "2026-08-01", plannedForDate: TODAY, estimateMinutes: 15, updatedAt: "2026-08-10T09:00:00Z" }),
    task({ id: "t2", priority: "medium", focusRank: 2, dueDate: "2026-08-12", plannedForDate: TODAY, estimateMinutes: 60, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "t4", priority: "low", focusRank: null, dueDate: null, plannedForDate: TODAY, estimateMinutes: null, updatedAt: "2026-08-10T07:00:00Z" }),
  ];
  const snap1 = snapshotFromRows({ selected: base });
  const snap2 = snapshotFromRows({ selected: [...base].reverse() });
  const snap3 = snapshotFromRows({ selected: [base[2], base[0], base[3], base[1]] });

  const p1 = buildOperatorProposal({ snapshot: snap1, now: new Date("2026-08-10T12:00:00Z") });
  const p2 = buildOperatorProposal({ snapshot: snap2, now: new Date("2026-08-10T12:00:00Z") });
  const p3 = buildOperatorProposal({ snapshot: snap3, now: new Date("2026-08-10T12:00:00Z") });

  assert.deepEqual(p1.candidateIds, p2.candidateIds);
  assert.deepEqual(p1.candidateIds, p3.candidateIds);
  assert.deepEqual(p1.tasks.map((t) => t.id), p2.tasks.map((t) => t.id));
});

// ---------------------------------------------------------------------------
// Reasons/evidence per Task
// ---------------------------------------------------------------------------

test("Every proposed Task includes reasons/evidence explaining selection", () => {
  const selected = [
    task({ id: "r1", priority: "urgent", dueDate: TODAY, focusRank: 1, plannedForDate: TODAY, estimateMinutes: 20, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "r2", priority: "low", dueDate: null, focusRank: null, plannedForDate: null, estimateMinutes: null, updatedAt: "2026-08-10T08:00:00Z" }),
  ];
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  for (const t of proposal.tasks) {
    assert.ok(Array.isArray(t.reasons) && t.reasons.length > 0, `task ${t.id} missing reasons`);
    assert.ok(t.evidence, `task ${t.id} missing evidence`);
    assert.equal(t.evidence.priority, t.priority);
    assert.equal(t.evidence.dueDate, t.dueDate);
    assert.equal(t.evidence.focusRank, t.focusRank);
    assert.equal(typeof t.evidence.hasActiveTimer, "boolean");
    assert.equal(typeof t.evidence.isPlannedForToday, "boolean");
  }
  // r1 should have multiple reasons covering urgent, due today, pinned etc
  const r1 = proposal.tasks.find((t) => t.id === "r1")!;
  assert.ok(r1.reasons.includes("Urgent priority"));
  assert.ok(r1.reasons.includes("Due today") || r1.reasons.includes("Overdue"));
  assert.ok(r1.reasons.some((r) => r.includes("Pinned")));
});

// ---------------------------------------------------------------------------
// Zero mutations — pure builder
// ---------------------------------------------------------------------------

test("Proposal generation makes zero durable mutations (pure, input not mutated)", () => {
  const selected = Array.from({ length: 5 }, (_, i) => task({ id: `m-${i}`, plannedForDate: TODAY }));
  const snap = snapshotFromRows({ selected });
  const snapJsonBefore = JSON.stringify(snap);
  const proposal1 = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  const snapJsonAfter = JSON.stringify(snap);
  assert.equal(snapJsonBefore, snapJsonAfter);
  // Calling twice yields identical result
  const proposal2 = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  assert.deepEqual(proposal1, proposal2);
  // Mutating proposal does not affect snapshot
  (proposal1.tasks as unknown as { push: (v: unknown) => void }).push?.(undefined);
});

// ---------------------------------------------------------------------------
// Sparse / empty days
// ---------------------------------------------------------------------------

test("Sparse/no-task days produce valid lightweight proposal/empty state", () => {
  const emptySnap = snapshotFromRows({ selected: [] });
  const emptyProposal = buildOperatorProposal({ snapshot: emptySnap, now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(emptyProposal.tasks.length, 0);
  assert.equal(emptyProposal.candidateIds.length, 0);
  assert.equal(emptyProposal.isSparse, true);
  assert.equal(emptyProposal.totalEstimateMinutes, 0);
  assert.equal(emptyProposal.version, OPERATOR_PROPOSAL_VERSION);
  assert.equal(emptyProposal.date, TODAY);
  assert.ok(emptyProposal.generatedAt);
  assert.equal(emptyProposal.sourceEvidence.totalCandidatesConsidered, 0);
  assert.deepEqual(emptyProposal.sourceEvidence.taskVersions, []);
});

test("Sparse with 2 candidates yields 2 tasks and isSparse true", () => {
  const selected = [task({ id: "s1", plannedForDate: TODAY }), task({ id: "s2", plannedForDate: TODAY })];
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(proposal.tasks.length, 2);
  assert.equal(proposal.isSparse, true);
  assert.equal(proposal.candidateIds.length, 2);
});

test("Sparse with 1 candidate yields 1 task", () => {
  const snap = snapshotFromRows({ selected: [task({ id: "only", plannedForDate: TODAY })] });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(proposal.tasks.length, 1);
  assert.equal(proposal.isSparse, true);
});

// ---------------------------------------------------------------------------
// Time-context id and version evidence for hash (EGA-526)
// ---------------------------------------------------------------------------

test("Proposal includes canonical local date/time-context identifier", () => {
  const snap = snapshotFromRows({ selected: [task({ id: "a", plannedForDate: TODAY })] });
  const proposalUtc = buildOperatorProposal({ snapshot: snap, timezone: "UTC", now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(proposalUtc.date, TODAY);
  assert.equal(proposalUtc.timezone, "UTC");
  assert.equal(proposalUtc.timeContextId, `${TODAY}::UTC`);
  assert.equal(proposalUtc.sourceEvidence.timeContextId, `${TODAY}::UTC`);
  assert.equal(proposalUtc.sourceEvidence.date, TODAY);
  assert.equal(proposalUtc.sourceEvidence.timezone, "UTC");

  const proposalNY = buildOperatorProposal({ snapshot: snap, timezone: "America/New_York", now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(proposalNY.timeContextId, `${TODAY}::America/New_York`);
  assert.equal(proposalNY.sourceEvidence.timezone, "America/New_York");
});

test("Proposal exposes source-state/version evidence for deterministic hash", () => {
  const selected = [
    task({ id: "v1", priority: "high", dueDate: TODAY, focusRank: 2, estimateMinutes: 30, plannedForDate: TODAY, updatedAt: "2026-08-10T10:00:00.000Z" }),
    task({ id: "v2", priority: "medium", dueDate: null, focusRank: null, estimateMinutes: null, plannedForDate: TODAY, updatedAt: "2026-08-10T09:00:00.000Z" }),
  ];
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, timezone: "UTC", now: new Date("2026-08-10T12:00:00.000Z") });
  assert.equal(proposal.sourceEvidence.version, OPERATOR_PROPOSAL_VERSION);
  assert.equal(proposal.sourceEvidence.candidateIds.length, proposal.candidateIds.length);
  assert.deepEqual(proposal.sourceEvidence.candidateIds, proposal.candidateIds);
  assert.equal(proposal.sourceEvidence.taskVersions.length, proposal.tasks.length);
  for (const v of proposal.sourceEvidence.taskVersions) {
    assert.ok(v.id);
    assert.ok(v.updatedAt);
    assert.ok(typeof v.status === "string");
    assert.ok(typeof v.priority === "string");
  }
  // Hash input is deterministic and ordered same as candidateIds
  const hashInput = getOperatorProposalHashInput(proposal);
  assert.equal(hashInput.version, OPERATOR_PROPOSAL_VERSION);
  assert.equal(hashInput.date, TODAY);
  assert.equal((hashInput.candidateIds as string[]).join(","), proposal.candidateIds.join(","));
  const versions = hashInput.taskVersions as Array<{ id: string }>;
  assert.deepEqual(versions.map((v) => v.id), proposal.candidateIds);
  // Deterministic: second call same input yields same hash input JSON
  const hashInput2 = getOperatorProposalHashInput(proposal);
  assert.deepEqual(hashInput, hashInput2);
  // Different task updatedAt changes hash input
  const selected2 = [
    task({ id: "v1", priority: "high", dueDate: TODAY, focusRank: 2, estimateMinutes: 30, plannedForDate: TODAY, updatedAt: "2026-08-10T11:00:00.000Z" }),
    task({ id: "v2", priority: "medium", dueDate: null, focusRank: null, estimateMinutes: null, plannedForDate: TODAY, updatedAt: "2026-08-10T09:00:00.000Z" }),
  ];
  const snap2 = snapshotFromRows({ selected: selected2 });
  const proposal2 = buildOperatorProposal({ snapshot: snap2, timezone: "UTC", now: new Date("2026-08-10T12:00:00.000Z") });
  const hashInputDiff = getOperatorProposalHashInput(proposal2);
  assert.notDeepEqual(hashInput, hashInputDiff);
});

test("Proposal hash input stable across input order shuffle", () => {
  const rows = [
    task({ id: "h1", priority: "high", plannedForDate: TODAY, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "h2", priority: "medium", plannedForDate: TODAY, updatedAt: "2026-08-10T09:00:00Z" }),
    task({ id: "h3", priority: "urgent", plannedForDate: TODAY, updatedAt: "2026-08-10T07:00:00Z" }),
  ];
  const snapA = snapshotFromRows({ selected: rows });
  const snapB = snapshotFromRows({ selected: [...rows].reverse() });
  const pA = buildOperatorProposal({ snapshot: snapA, now: new Date("2026-08-10T12:00:00Z") });
  const pB = buildOperatorProposal({ snapshot: snapB, now: new Date("2026-08-10T12:00:00Z") });
  assert.deepEqual(getOperatorProposalHashInput(pA), getOperatorProposalHashInput(pB));
});

// ---------------------------------------------------------------------------
// Web/mobile preview: deselect/reorder locally, reject — side-effect free
// ---------------------------------------------------------------------------

test("Proposal supports local preview: client can deselect/reorder without mutation", () => {
  const selected = Array.from({ length: 6 }, (_, i) => task({ id: `preview-${i}`, plannedForDate: TODAY, estimateMinutes: 20 }));
  const snap = snapshotFromRows({ selected });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  const originalIds = [...proposal.candidateIds];
  // Client-side deselect (filter) does not mutate original
  const deselected = proposal.tasks.filter((t) => t.id !== "preview-0");
  assert.equal(deselected.length, 5);
  assert.equal(proposal.tasks.length, 6);
  assert.deepEqual(proposal.candidateIds, originalIds);
  // Client-side reorder (sort by title) does not mutate original ordering
  const reordered = [...proposal.tasks].sort((a, b) => b.title.localeCompare(a.title));
  assert.notDeepEqual(reordered.map((t) => t.id), originalIds);
  assert.deepEqual(proposal.candidateIds, originalIds);
  // Reject is just ignoring proposal — no mutation
  assert.ok(proposal);
});

// ---------------------------------------------------------------------------
// getOperatorProposal use case — zero mutations, deterministic
// ---------------------------------------------------------------------------

class FakeTodayPort implements TodayReadPort {
  calls: string[] = [];
  constructor(
    private readonly selected: TodaySourceTask[],
    private readonly pinned: TodaySourceTask[] = [],
    private readonly inProgress: TodaySourceTask[] = [],
    private readonly timer: { sessionId: string; taskId: string } | null = null,
  ) {}
  async listSelectedTasks(actor: AuthenticatedActor) {
    this.calls.push("listSelectedTasks");
    return ok(this.selected);
  }
  async listPinnedSuggestions(actor: AuthenticatedActor) {
    this.calls.push("listPinnedSuggestions");
    return ok(this.pinned);
  }
  async listInProgressSuggestions(actor: AuthenticatedActor) {
    this.calls.push("listInProgressSuggestions");
    return ok(this.inProgress);
  }
  async getTodayTimerSnapshot(actor: AuthenticatedActor) {
    this.calls.push("getTodayTimerSnapshot");
    return ok({ activeTimer: this.timer, trackedTodaySeconds: 0 });
  }
}

test("getOperatorProposal is deterministic and side-effect free", async () => {
  const selected = [
    task({ id: "g1", priority: "high", plannedForDate: TODAY, updatedAt: "2026-08-10T08:00:00Z" }),
    task({ id: "g2", priority: "medium", plannedForDate: TODAY, updatedAt: "2026-08-10T09:00:00Z" }),
  ];
  const port = new FakeTodayPort(selected);
  const actor = createAuthenticatedActor("user-1");
  const r1 = await getOperatorProposal(actor, port, { date: TODAY, timezone: "UTC", now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const r2 = await getOperatorProposal(actor, port, { date: TODAY, timezone: "UTC", now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.deepEqual(r1.data.candidateIds, r2.data.candidateIds);
  assert.deepEqual(r1.data, r2.data);
  // No mutation methods called: only reads
  assert.deepEqual(port.calls, [
    "listSelectedTasks",
    "listPinnedSuggestions",
    "listInProgressSuggestions",
    "getTodayTimerSnapshot",
    "listSelectedTasks",
    "listPinnedSuggestions",
    "listInProgressSuggestions",
    "getTodayTimerSnapshot",
  ]);
});

test("getOperatorProposal validates date", async () => {
  const port = new FakeTodayPort([]);
  const actor = createAuthenticatedActor("user-1");
  const result = await getOperatorProposal(actor, port, { date: "bad-date" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errorMessage, "Today date is invalid.");
});

test("getOperatorProposal sparse day with suggestions fills proposal from focus/due/in-progress evidence", async () => {
  // No selected tasks, but pinned and in-progress suggestions provide candidates
  const pinned = [task({ id: "pinned-1", focusRank: 1, plannedForDate: null })];
  const inProg = [task({ id: "ip-1", status: "in_progress", plannedForDate: null })];
  const port = new FakeTodayPort([], pinned, inProg);
  const actor = createAuthenticatedActor("user-1");
  const result = await getOperatorProposal(actor, port, { date: TODAY, now: new Date("2026-08-10T12:00:00Z") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.candidateIds.includes("pinned-1"), true);
  assert.equal(result.data.candidateIds.includes("ip-1"), true);
  assert.equal(result.data.tasks.length, 2);
});

test("Proposal deduplicates tasks appearing in both selected and suggestions", () => {
  const dup = task({ id: "dup-1", priority: "high", plannedForDate: TODAY, focusRank: 1 });
  const selected = [dup];
  const pinned = [dup];
  const snap = snapshotFromRows({ selected, pinned });
  const proposal = buildOperatorProposal({ snapshot: snap, now: new Date("2026-08-10T12:00:00Z") });
  const count = proposal.candidateIds.filter((id) => id === "dup-1").length;
  assert.equal(count, 1);
});
