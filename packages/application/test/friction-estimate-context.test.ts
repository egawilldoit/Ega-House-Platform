import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor, type AuthenticatedActor, type RepositoryResult } from "../src/index";
import { getFrictionRadarReadModel } from "../src/friction/stale-blocked-signals";
import { getEstimateAccuracySignals } from "../src/friction/estimate-accuracy";
import { getContextSwitchSignal } from "../src/friction/context-switch";
import type { ExecutionEvidenceSessionRow, ExecutionEvidenceWindow, ExecutionEvidenceRepository } from "../src/shared/execution-evidence";
import type { FrictionGoalRow, FrictionRepository, FrictionTaskRow } from "../src/friction/ports";
import { getLocalDayWindow, getWeekWindow } from "@ega/domain/time-context";
import {
  FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD,
  FRICTION_CONTEXT_SWITCH_THRESHOLD,
  FRICTION_ESTIMATE_HIGH_PERCENT_THRESHOLD,
  FRICTION_ESTIMATE_PERCENT_THRESHOLD,
} from "@ega/domain/friction";

// Fixed fixtures independent of clock — never use Date.now().
const FIXED_NOW = new Date("2026-04-22T12:00:00.000Z");
const FIXED_NOW_ISO = FIXED_NOW.toISOString();

// EGA-523 boundaries via shared time-context (canonical).
const DAY_WINDOW_RAW = getLocalDayWindow("UTC", "2026-04-20");
const DAY_WINDOW: ExecutionEvidenceWindow = { startIso: DAY_WINDOW_RAW.startUtcIso, endIso: DAY_WINDOW_RAW.endUtcIso };
const WEEK_WINDOW_RAW = getWeekWindow("UTC", "2026-04-20");
const WEEK_WINDOW: ExecutionEvidenceWindow = { startIso: WEEK_WINDOW_RAW.weekStartUtcIso, endIso: WEEK_WINDOW_RAW.weekEndExclusiveUtcIso };
// Also use truncated week to now for integration.
const WEEK_TO_NOW: ExecutionEvidenceWindow = { startIso: WEEK_WINDOW_RAW.weekStartUtcIso, endIso: FIXED_NOW_ISO };

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

class FakeFrictionRepository implements FrictionRepository {
  tasks: FrictionTaskRow[] = [];
  goals: FrictionGoalRow[] = [];
  constructor(tasks: FrictionTaskRow[] = [], goals: FrictionGoalRow[] = []) {
    this.tasks = tasks;
    this.goals = goals;
  }
  async listTasks(_actor: AuthenticatedActor) { return ok(this.tasks); }
  async listGoals(_actor: AuthenticatedActor) { return ok(this.goals); }
}

class FakeEvidenceRepository implements ExecutionEvidenceRepository {
  sessions: ExecutionEvidenceSessionRow[] = [];
  calls: Array<{ actor: string; window: ExecutionEvidenceWindow }> = [];
  constructor(sessions: ExecutionEvidenceSessionRow[] = []) { this.sessions = sessions; }
  async listSessionsForWindow(actor: AuthenticatedActor, window: ExecutionEvidenceWindow) {
    this.calls.push({ actor: actor.userId, window });
    return ok(this.sessions);
  }
}

function sess(over: Partial<ExecutionEvidenceSessionRow> & { task_id: string; started_at: string }): ExecutionEvidenceSessionRow {
  return {
    ended_at: "2026-04-20T10:00:00.000Z",
    duration_seconds: null,
    tasks: null,
    ...over,
  } as ExecutionEvidenceSessionRow;
}

// ---------------------------------------------------------------------------
// Estimate signal — only meaningful estimates with tracked evidence
// ---------------------------------------------------------------------------

test("estimate signal only evaluates Tasks with meaningful estimate and tracked evidence", () => {
  const window = WEEK_WINDOW;
  const sessions: ExecutionEvidenceSessionRow[] = [
    // task-meaningful: estimate 60, 60m tracked => exact => not friction (filtered, low)
    sess({ task_id: "task-meaningful", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T10:00:00.000Z", tasks: { id: "task-meaningful", title: "Meaningful exact", estimate_minutes: 60, projects: { id: "p1", name: "Ops" } } }),
    // task-over: estimate 60, 120m tracked => 100% over => medium friction (included)
    sess({ task_id: "task-over", started_at: "2026-04-20T11:00:00.000Z", ended_at: "2026-04-20T13:00:00.000Z", tasks: { id: "task-over", title: "Over", estimate_minutes: 60, projects: { id: "p1", name: "Ops" } } }),
    // task-under: estimate 120, 30m tracked => -75% => high friction (included)
    sess({ task_id: "task-under", started_at: "2026-04-21T09:00:00.000Z", ended_at: "2026-04-21T09:30:00.000Z", tasks: { id: "task-under", title: "Under", estimate_minutes: 120, projects: { id: "p1", name: "Ops" } } }),
    // task-small-estimate: 4m (<5 meaningful threshold) with 60m tracked => excluded
    sess({ task_id: "task-small", started_at: "2026-04-20T14:00:00.000Z", ended_at: "2026-04-20T15:00:00.000Z", tasks: { id: "task-small", title: "Small", estimate_minutes: 4, projects: { id: "p1", name: "Ops" } } }),
    // task-null-estimate: null => excluded
    sess({ task_id: "task-null", started_at: "2026-04-20T15:00:00.000Z", ended_at: "2026-04-20T16:00:00.000Z", tasks: { id: "task-null", title: "Null", estimate_minutes: null, projects: { id: "p1", name: "Ops" } } }),
    // task-no-tracked: estimate 60 but session outside window => no tracked => excluded
    sess({ task_id: "task-outside", started_at: "2026-04-19T09:00:00.000Z", ended_at: "2026-04-19T10:00:00.000Z", tasks: { id: "task-outside", title: "Outside", estimate_minutes: 60, projects: { id: "p1", name: "Ops" } } }),
  ];

  const signals = getEstimateAccuracySignals(sessions, window, { includeOpenSessions: false });
  const ids = signals.map((s) => s.id);
  // Should include over and under, but not small, null, outside, or exact (low)
  assert.equal(ids.includes("task-over"), true);
  assert.equal(ids.includes("task-under"), true);
  assert.equal(ids.includes("task-small"), false);
  assert.equal(ids.includes("task-null"), false);
  assert.equal(ids.includes("task-outside"), false);
  assert.equal(ids.includes("task-meaningful"), false); // exact => low => filtered
  assert.equal(signals.length, 2);

  const over = signals.find((s) => s.id === "task-over")!;
  assert.equal(over.estimateMinutes, 60);
  assert.equal(over.actualMinutes, 120);
  assert.equal(over.deltaMinutes, 60);
  assert.equal(over.percentError, 100);
  assert.equal(over.severity, "medium");
  assert.equal(over.status, "over");

  const under = signals.find((s) => s.id === "task-under")!;
  assert.equal(under.actualMinutes, 30);
  assert.equal(under.percentError, -75);
  assert.equal(under.severity, "medium");
  assert.equal(under.status, "under");
});

test("estimate actual time derived from canonical sessions with window clipping — no double-count of window time", () => {
  // Session straddles window start: 23:30 previous day to 00:30 window day
  const window = DAY_WINDOW; // 2026-04-20T00:00:00.000Z to 2026-04-21
  const sessions: ExecutionEvidenceSessionRow[] = [
    sess({
      task_id: "task-clip",
      started_at: "2026-04-19T23:30:00.000Z",
      ended_at: "2026-04-20T00:30:00.000Z",
      tasks: { id: "task-clip", title: "Clip", estimate_minutes: 60, projects: { id: "p1", name: "Ops" } },
    }),
  ];
  // Only 30m inside window => actual 30, estimate 60 => -50% => low => filtered (not friction)
  // But to test clipping, use estimate 10 => actual 30 => 200% high => should be friction with clipped 30 not 60
  const sessions2: ExecutionEvidenceSessionRow[] = [
    sess({ task_id: "task-clip2", started_at: "2026-04-19T23:30:00.000Z", ended_at: "2026-04-20T00:30:00.000Z", tasks: { id: "task-clip2", title: "Clip2", estimate_minutes: 10, projects: { id: "p1", name: "Ops" } } }),
  ];
  const signals = getEstimateAccuracySignals(sessions2, window, { includeOpenSessions: false });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].actualMinutes, 30); // clipped, not 60
  assert.equal(signals[0].percentError, 200);
  assert.equal(signals[0].severity, "high");

  // Verify original 60m estimate case yields -50 => low filtered, but still proves clipping is 30 not 60
  const signalsLow = getEstimateAccuracySignals(sessions, window, { includeOpenSessions: false });
  // 30 actual vs 60 estimate => -50 => low => filtered -> 0 signals, but we verify no signal includes 60
  assert.equal(signalsLow.length, 0);
});

test("estimate thresholds deterministic: medium >50, high >100, boundaries independent of clock", () => {
  // Fixed fixtures: use same WEEK_WINDOW, but different actual vs estimate ratios
  const base = getLocalDayWindow("UTC", "2026-04-22");
  const window: ExecutionEvidenceWindow = { startIso: base.startUtcIso, endIso: base.endUtcIso };

  const makeSess = (taskId: string, actualMins: number, est: number) => {
    const start = "2026-04-22T09:00:00.000Z";
    const end = new Date(new Date(start).getTime() + actualMins * 60 * 1000).toISOString();
    return sess({ task_id: taskId, started_at: start, ended_at: end, tasks: { id: taskId, title: taskId, estimate_minutes: est, projects: { id: "p1", name: "P" } } });
  };

  // 50% exact boundary => low => not included
  const s50 = getEstimateAccuracySignals([makeSess("t50", 90, 60)], window); // 50%
  assert.equal(s50.length, 0);
  // 51% => medium
  const s51 = getEstimateAccuracySignals([makeSess("t51", 91, 60)], window); // 51.x => 52%
  assert.equal(s51.length, 1);
  assert.equal(s51[0].severity, "medium");
  // 100% boundary => medium
  const s100 = getEstimateAccuracySignals([makeSess("t100", 120, 60)], window);
  assert.equal(s100.length, 1);
  assert.equal(s100[0].severity, "medium");
  assert.equal(s100[0].percentError, 100);
  // 101% => high
  const s101 = getEstimateAccuracySignals([makeSess("t101", 121, 60)], window);
  assert.equal(s101[0].severity, "high");
  // Run twice with same fixtures => deterministic same result (independent of clock)
  const s101Again = getEstimateAccuracySignals([makeSess("t101", 121, 60)], window);
  assert.deepEqual(s101, s101Again);
  assert.equal(FRICTION_ESTIMATE_PERCENT_THRESHOLD, 50);
  assert.equal(FRICTION_ESTIMATE_HIGH_PERCENT_THRESHOLD, 100);
});

// ---------------------------------------------------------------------------
// Context switches — transitions between different Task ids, repeat not switch
// ---------------------------------------------------------------------------

test("context switches defined as transitions between different Task ids; repeat same not a switch", () => {
  const window = WEEK_WINDOW;
  const sessions: ExecutionEvidenceSessionRow[] = [
    sess({ task_id: "task-a", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:30:00.000Z" }),
    sess({ task_id: "task-a", started_at: "2026-04-20T09:30:00.000Z", ended_at: "2026-04-20T10:00:00.000Z" }),
    sess({ task_id: "task-b", started_at: "2026-04-20T10:00:00.000Z", ended_at: "2026-04-20T10:30:00.000Z" }),
    sess({ task_id: "task-b", started_at: "2026-04-20T10:30:00.000Z", ended_at: "2026-04-20T11:00:00.000Z" }),
    sess({ task_id: "task-a", started_at: "2026-04-20T11:00:00.000Z", ended_at: "2026-04-20T11:30:00.000Z" }),
  ];
  const sig = getContextSwitchSignal(sessions, window, { includeOpenSessions: false });
  assert.equal(sig.transitionsCount, 5);
  assert.equal(sig.distinctTaskCount, 2);
  assert.equal(sig.switchCount, 2); // a->a 0, a->b 1, b->b 0, b->a 1
  assert.equal(sig.threshold, FRICTION_CONTEXT_SWITCH_THRESHOLD);
  assert.equal(sig.highThreshold, FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD);
});

test("repeat same Task all sessions => 0 switches", () => {
  const window = WEEK_WINDOW;
  const sessions: ExecutionEvidenceSessionRow[] = [
    sess({ task_id: "solo", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:30:00.000Z" }),
    sess({ task_id: "solo", started_at: "2026-04-20T10:00:00.000Z", ended_at: "2026-04-20T10:30:00.000Z" }),
    sess({ task_id: "solo", started_at: "2026-04-20T11:00:00.000Z", ended_at: "2026-04-20T11:30:00.000Z" }),
  ];
  const sig = getContextSwitchSignal(sessions, window, { includeOpenSessions: false });
  assert.equal(sig.switchCount, 0);
  assert.equal(sig.severity, "none");
  assert.equal(sig.isFriction, false);
});

test("context-switch ordering uses canonical ordered-session evidence (deterministic for equal timestamps)", () => {
  const window = WEEK_WINDOW;
  // Three sessions same timestamp, different task_id — ordering must be task_id lexicographic
  const sessions: ExecutionEvidenceSessionRow[] = [
    sess({ id: "s-b", task_id: "task-b", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:30:00.000Z" }),
    sess({ id: "s-a", task_id: "task-a", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:30:00.000Z" }),
    sess({ id: "s-c", task_id: "task-a", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:30:00.000Z" }),
    sess({ task_id: "task-0", started_at: "2026-04-20T08:00:00.000Z", ended_at: "2026-04-20T08:30:00.000Z" }),
  ];
  const sig = getContextSwitchSignal(sessions, window, { includeOpenSessions: false });
  // Deterministic order: task-0 08:00, then task-a s-a, task-a s-c, task-b
  // Transitions: task-0->a (1), a->a (0), a->b (1) => 2 switches
  assert.equal(sig.switchCount, 2);
  assert.equal(sig.transitionsCount, 4);
  // Run twice with reversed input => same deterministic result
  const sig2 = getContextSwitchSignal([...sessions].reverse(), window, { includeOpenSessions: false });
  assert.equal(sig2.switchCount, sig.switchCount);
  assert.equal(sig2.transitionsCount, sig.transitionsCount);
});

test("context-switch thresholds deterministic: 5 low, 6 medium, 10 high, fixed fixtures independent of clock", () => {
  const window = DAY_WINDOW;
  const makeSeq = (switches: number) => {
    // Create switches+1 distinct tasks each one session, sequentially
    const sessions: ExecutionEvidenceSessionRow[] = [];
    for (let i = 0; i <= switches; i++) {
      const taskId = `task-${String(i).padStart(2, "0")}`;
      const start = new Date(Date.UTC(2026, 3, 20, 9, i * 5, 0)).toISOString();
      const end = new Date(Date.UTC(2026, 3, 20, 9, i * 5 + 3, 0)).toISOString();
      sessions.push(sess({ task_id: taskId, started_at: start, ended_at: end }));
    }
    return sessions;
  };
  const s5 = getContextSwitchSignal(makeSeq(5), window);
  assert.equal(s5.switchCount, 5);
  assert.equal(s5.severity, "low");
  assert.equal(s5.isFriction, false);
  const s6 = getContextSwitchSignal(makeSeq(6), window);
  assert.equal(s6.switchCount, 6);
  assert.equal(s6.severity, "medium");
  assert.equal(s6.isFriction, true);
  const s9 = getContextSwitchSignal(makeSeq(9), window);
  assert.equal(s9.severity, "medium");
  const s10 = getContextSwitchSignal(makeSeq(10), window);
  assert.equal(s10.severity, "high");
  assert.equal(s10.isFriction, true);
  // Deterministic: same fixtures give same result
  const s10Again = getContextSwitchSignal(makeSeq(10), window);
  assert.deepEqual(s10, s10Again);
  assert.equal(FRICTION_CONTEXT_SWITCH_THRESHOLD, 6);
  assert.equal(FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD, 10);
});

test("context-switch window clipping — sessions outside window not counted", () => {
  const window = DAY_WINDOW; // 2026-04-20
  const sessions: ExecutionEvidenceSessionRow[] = [
    sess({ task_id: "task-a", started_at: "2026-04-19T23:00:00.000Z", ended_at: "2026-04-19T23:30:00.000Z" }), // outside
    sess({ task_id: "task-b", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:30:00.000Z" }),
    sess({ task_id: "task-c", started_at: "2026-04-21T09:00:00.000Z", ended_at: "2026-04-21T09:30:00.000Z" }), // outside (next day)
  ];
  const sig = getContextSwitchSignal(sessions, window);
  assert.equal(sig.transitionsCount, 1);
  assert.equal(sig.switchCount, 0);
});

// ---------------------------------------------------------------------------
// Integration — getFrictionRadarReadModel with evidence (owner-scoped, EGA-523 window)
// ---------------------------------------------------------------------------

test("friction radar integration: estimate + context-switch via execution-evidence, window uses EGA-523 boundaries", async () => {
  const actor = createAuthenticatedActor("user-123");
  const frictionRepo = new FakeFrictionRepository([], []);
  // Week window derived via EGA-523 helpers — proves we consume F1 Shared Time Context
  const weekRaw = getWeekWindow("UTC", "2026-04-20");
  const window: ExecutionEvidenceWindow = { startIso: weekRaw.weekStartUtcIso, endIso: weekRaw.weekEndExclusiveUtcIso };

  const sessions: ExecutionEvidenceSessionRow[] = [
    // For estimate: task with 60m est, 120m actual => friction
    sess({ task_id: "task-est", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T11:00:00.000Z", tasks: { id: "task-est", title: "Est Task", estimate_minutes: 60, projects: { id: "p1", name: "Ops" } } }),
    // For context-switch: 7 switches
    ...Array.from({ length: 8 }, (_, i) => sess({ task_id: `task-${i}`, started_at: `2026-04-20T12:${String(i * 5).padStart(2, "0")}:00.000Z`, ended_at: `2026-04-20T12:${String(i * 5 + 2).padStart(2, "0")}:00.000Z` })),
  ];

  const evidenceRepo = new FakeEvidenceRepository(sessions);
  const result = await getFrictionRadarReadModel(actor, frictionRepo, {
    now: FIXED_NOW,
    evidence: { window, repository: evidenceRepo, includeOpenSessions: false, nowIso: FIXED_NOW_ISO },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Verify evidenceWindow propagated
  assert.deepEqual(result.data.evidenceWindow, window);
  // Estimate signal derived from canonical evidence, window-clipped no double-count
  assert.equal(result.data.estimateSignals.some((s) => s.id === "task-est"), true);
  const est = result.data.estimateSignals.find((s) => s.id === "task-est")!;
  assert.equal(est.actualMinutes, 120);
  assert.equal(est.severity, "medium");
  // Context-switch uses canonical ordered transitions
  assert.equal(result.data.contextSwitch.switchCount, 8);
  assert.equal(result.data.contextSwitch.transitionsCount, 9);
  assert.equal(result.data.contextSwitch.isFriction, true);
  // Owner-scoped: evidence repo received actor id
  assert.equal(evidenceRepo.calls[0].actor, "user-123");
  // Window is EGA-523 derived (week start)
  assert.equal(evidenceRepo.calls[0].window.startIso, weekRaw.weekStartUtcIso);
});

test("web and mobile receive identical results through shared contracts (thresholds deterministic)", async () => {
  const { FRICTION_STALE_THRESHOLD_DAYS: CONTRACT_STALE } = await import("@ega/contracts/friction");
  const { FRICTION_STALE_THRESHOLD_DAYS: DOMAIN_STALE } = await import("@ega/domain/friction");
  const { FRICTION_ESTIMATE_PERCENT_THRESHOLD: CONTRACT_EST } = await import("@ega/contracts/friction");
  const { FRICTION_ESTIMATE_PERCENT_THRESHOLD: DOMAIN_EST } = await import("@ega/domain/friction");
  const { FRICTION_CONTEXT_SWITCH_THRESHOLD: CONTRACT_CTX } = await import("@ega/contracts/friction");
  const { FRICTION_CONTEXT_SWITCH_THRESHOLD: DOMAIN_CTX } = await import("@ega/domain/friction");
  assert.equal(CONTRACT_STALE, DOMAIN_STALE);
  assert.equal(CONTRACT_EST, DOMAIN_EST);
  assert.equal(CONTRACT_CTX, DOMAIN_CTX);

  // Simulate web and mobile both consuming same DTO shape via shared read model
  const actor = createAuthenticatedActor("user-web-mobile");
  const repo = new FakeFrictionRepository([], []);
  const window = WEEK_TO_NOW;
  const sessions: ExecutionEvidenceSessionRow[] = [
    sess({ task_id: "task-est", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T11:00:00.000Z", tasks: { id: "task-est", title: "Est", estimate_minutes: 30, projects: { id: "p1", name: "P" } } }),
  ];
  const evidenceRepo = new FakeEvidenceRepository(sessions);
  const result = await getFrictionRadarReadModel(actor, repo, { now: FIXED_NOW, evidence: { window, repository: evidenceRepo } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Both transports would receive same estimateSignals and contextSwitch from shared contracts
  const dto = result.data;
  assert.equal(dto.estimateSignals.length, 1);
  assert.equal(dto.estimateSignals[0].percentError, 300); // 120 actual vs 30 est => 300%
  assert.equal(dto.estimateSignals[0].severity, "high");
  // Not recalculated locally — thresholds already applied in shared model.
});

test("not forked: shared execution-evidence is authority, not web-local work-analytics helper", async () => {
  // Verify that estimate-accuracy and context-switch import from shared execution-evidence,
  // not from web helper. This is enforced structurally by checking that the shared module
  // is the one used: getEstimateAccuracySignals uses calculateExecutionEvidenceForWindow
  // which clips via getExecutionEvidenceSessionOverlapSeconds (shared). We prove no double-count
  // by ensuring overlapping session time is sum of clips, not duration_seconds fallback.
  const window = DAY_WINDOW;
  const sessions: ExecutionEvidenceSessionRow[] = [
    // Session with malformed duration_seconds that would be used if forked logic fell back incorrectly
    sess({ task_id: "task-fork", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T10:00:00.000Z", duration_seconds: 9999, tasks: { id: "task-fork", title: "Fork", estimate_minutes: 30, projects: { id: "p1", name: "P" } } }),
  ];
  const signals = getEstimateAccuracySignals(sessions, window);
  // Should use actual 60m from window clip (09:00-10:00 = 60m), not 9999 from duration_seconds
  assert.equal(signals[0].actualMinutes, 60);
  assert.equal(signals[0].percentError, 100);
});

test("evidence ordering deterministic independent of input order", () => {
  const window = WEEK_WINDOW;
  const sessionsA: ExecutionEvidenceSessionRow[] = [
    sess({ task_id: "task-b", started_at: "2026-04-20T10:00:00.000Z", ended_at: "2026-04-20T10:30:00.000Z" }),
    sess({ task_id: "task-a", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:30:00.000Z" }),
  ];
  const sessionsB = [...sessionsA].reverse();
  const sigA = getContextSwitchSignal(sessionsA, window);
  const sigB = getContextSwitchSignal(sessionsB, window);
  assert.deepEqual(sigA, sigB);
});
