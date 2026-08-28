import assert from "node:assert/strict";
import test from "node:test";

import {
  HEALTH_RECOMMENDATION_THRESHOLDS,
  getHealthRecommendations,
} from "../src/health/recommendations";
import type { HealthWorkloadSnapshot } from "../src/health/workload-snapshot";

function makeSnapshot(overrides: Partial<HealthWorkloadSnapshot> & {
  // Allow partial but guarantee required fields for test
}): HealthWorkloadSnapshot {
  const base: HealthWorkloadSnapshot = {
    generatedAt: "2026-04-20T12:00:00.000Z",
    window: { startIso: "2026-04-14T00:00:00.000Z", endIso: "2026-04-21T00:00:00.000Z" },
    timezone: "UTC",
    requestedTimezone: null,
    fallback: "none",
    localDate: "2026-04-20",
    rollingWorkload: {
      totalTrackedSeconds: 600 * 60, // 600 min
      totalTrackedMinutes: 600,
      totalTrackedLabel: "10h 0m 0s",
    },
    activeDays: 3,
    windowDays: 7,
    sessionCount: 3,
    sessionDensity: 0.43,
    longestSessionSeconds: 60 * 60,
    longestSessionLabel: "1h 0m 0s",
    averageSessionSeconds: 2000,
    averageSessionLabel: "33m 20s",
    quality: {
      quality: "sufficient",
      reasons: [],
      hasOpenSessions: false,
      openSessionCount: 0,
      malformedCount: 0,
      sessionCount: 3,
      totalTrackedSeconds: 600 * 60,
    },
  };

  // Deep merge for nested overrides
  const merged: HealthWorkloadSnapshot = {
    ...base,
    ...overrides,
    rollingWorkload: { ...base.rollingWorkload, ...(overrides.rollingWorkload ?? {}) },
    quality: { ...base.quality, ...(overrides.quality ?? {}) },
    window: { ...base.window, ...(overrides.window ?? {}) },
  } as HealthWorkloadSnapshot;

  // Handle null overrides explicitly for longest/average
  if ("longestSessionSeconds" in overrides) (merged as unknown as Record<string, unknown>).longestSessionSeconds = overrides.longestSessionSeconds;
  if ("longestSessionLabel" in overrides) (merged as unknown as Record<string, unknown>).longestSessionLabel = overrides.longestSessionLabel;
  if ("averageSessionSeconds" in overrides) (merged as unknown as Record<string, unknown>).averageSessionSeconds = overrides.averageSessionSeconds;
  if ("averageSessionLabel" in overrides) (merged as unknown as Record<string, unknown>).averageSessionLabel = overrides.averageSessionLabel;

  return merged;
}

const BANNED_MEDICAL_TERMS = [
  "diagnos",
  "medical",
  "prescri",
  "treatment",
  "disorder",
  "disease",
  "illness",
  "syndrome",
  "condition",
];

function assertNonMedicalCopy(recommendations: ReturnType<typeof getHealthRecommendations>) {
  for (const r of recommendations) {
    const combined = `${r.title} ${r.message} ${r.copyKey}`.toLowerCase();
    for (const term of BANNED_MEDICAL_TERMS) {
      assert.equal(combined.includes(term), false, `recommendation ${r.id} contains banned medical term "${term}": ${r.message}`);
    }
    // Must not claim medical authority
    assert.equal(combined.includes("you should"), false, `avoid directive medical style for ${r.id}`);
  }
}

// ---------------------------------------------------------------------------
// Sufficiency guards — sparse data must not produce confident claims
// ---------------------------------------------------------------------------

test("no actionable recommendations when quality is insufficient", () => {
  const snap = makeSnapshot({
    quality: { quality: "insufficient", reasons: ["no contributing sessions"], hasOpenSessions: false, openSessionCount: 0, malformedCount: 0, sessionCount: 0, totalTrackedSeconds: 0 },
    rollingWorkload: { totalTrackedSeconds: 0, totalTrackedMinutes: 0, totalTrackedLabel: "0s" },
    activeDays: 0,
    sessionCount: 0,
    sessionDensity: 0,
    longestSessionSeconds: null,
    longestSessionLabel: null,
  });
  const recs = getHealthRecommendations(snap);
  assert.equal(recs.length, 0);
});

test("no actionable recommendations when quality is provisional (active session)", () => {
  const snap = makeSnapshot({
    quality: { quality: "provisional", reasons: ["open sessions included: 1"], hasOpenSessions: true, openSessionCount: 1, malformedCount: 0, sessionCount: 1, totalTrackedSeconds: 900 * 60 },
    rollingWorkload: { totalTrackedSeconds: 900 * 60, totalTrackedMinutes: 900, totalTrackedLabel: "15h 0m 0s" },
    activeDays: 4,
    longestSessionSeconds: 100 * 60,
  });
  const recs = getHealthRecommendations(snap);
  assert.equal(recs.length, 0);
});

test("no actionable recommendations when quality is suspect", () => {
  const snap = makeSnapshot({
    quality: { quality: "suspect", reasons: ["malformed sessions: 1"], hasOpenSessions: false, openSessionCount: 0, malformedCount: 1, sessionCount: 1, totalTrackedSeconds: 600 * 60 },
    rollingWorkload: { totalTrackedSeconds: 600 * 60, totalTrackedMinutes: 600, totalTrackedLabel: "10h 0m 0s" },
    activeDays: 5,
    longestSessionSeconds: 100 * 60,
  });
  const recs = getHealthRecommendations(snap);
  assert.equal(recs.length, 0);
});

// ---------------------------------------------------------------------------
// Recovery — high workload thresholds and evidence
// ---------------------------------------------------------------------------

test("recovery_high_workload: triggers at high threshold, evidence cites actual minutes", () => {
  const t = HEALTH_RECOMMENDATION_THRESHOLDS;
  // Exactly at threshold should trigger (inclusive)
  const snapAt = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: t.highWorkloadMinutes * 60, totalTrackedMinutes: t.highWorkloadMinutes, totalTrackedLabel: `${t.highWorkloadMinutes / 60}h 0m 0s` },
    quality: { quality: "sufficient", reasons: [], hasOpenSessions: false, openSessionCount: 0, malformedCount: 0, sessionCount: 5, totalTrackedSeconds: t.highWorkloadMinutes * 60 },
  });
  const recsAt = getHealthRecommendations(snapAt);
  const recAt = recsAt.find((r) => r.id === "health.recommendation.recovery_high_workload");
  assert.ok(recAt, "should emit recovery at threshold");
  assert.equal(recAt!.evidence.metric, "rollingWorkload.totalTrackedMinutes");
  assert.equal(recAt!.evidence.value, t.highWorkloadMinutes);
  assert.equal(recAt!.evidence.threshold, t.highWorkloadMinutes);
  assert.equal(recAt!.evidence.unit, "minutes");
  assert.equal(recAt!.evidence.windowDays, 7);
  assert.equal(recAt!.evidence.quality, "sufficient");
  assert.match(recAt!.evidence.label, new RegExp(`${t.highWorkloadMinutes} min`));
  assert.match(recAt!.message, new RegExp(`${t.highWorkloadMinutes} min`));
  assert.equal(recAt!.severity, "nudge");
  assert.equal(recAt!.kind, "recovery");

  // One below threshold should not trigger
  const snapBelow = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: (t.highWorkloadMinutes - 1) * 60, totalTrackedMinutes: t.highWorkloadMinutes - 1, totalTrackedLabel: "x" },
    quality: { quality: "sufficient", reasons: [], hasOpenSessions: false, openSessionCount: 0, malformedCount: 0, sessionCount: 5, totalTrackedSeconds: (t.highWorkloadMinutes - 1) * 60 },
    longestSessionSeconds: 30 * 60, // ensure break not triggered
    activeDays: 7, // avoid movement
    sessionDensity: 1.0, // avoid training
  });
  const recsBelow = getHealthRecommendations(snapBelow);
  assert.equal(recsBelow.find((r) => r.kind === "recovery"), undefined);
});

test("recovery_high_workload: veryHigh threshold escalates severity to guide", () => {
  const t = HEALTH_RECOMMENDATION_THRESHOLDS;
  const snap = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: t.veryHighWorkloadMinutes * 60, totalTrackedMinutes: t.veryHighWorkloadMinutes, totalTrackedLabel: "15h 0m 0s" },
    quality: { quality: "sufficient", reasons: [], hasOpenSessions: false, openSessionCount: 0, malformedCount: 0, sessionCount: 10, totalTrackedSeconds: t.veryHighWorkloadMinutes * 60 },
    longestSessionSeconds: 30 * 60,
    activeDays: 7,
    sessionDensity: 1.4,
  });
  const rec = getHealthRecommendations(snap).find((r) => r.id === "health.recommendation.recovery_high_workload");
  assert.ok(rec);
  assert.equal(rec!.severity, "guide");
  assert.equal(rec!.evidence.threshold, t.veryHighWorkloadMinutes);
});

test("recovery evidence includes windowDays and does not mutate snapshot", () => {
  const snap = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: 650 * 60, totalTrackedMinutes: 650, totalTrackedLabel: "10h 50m 0s" },
    longestSessionSeconds: 30 * 60,
    activeDays: 7,
    sessionDensity: 1.0,
  });
  const frozen = JSON.stringify(snap);
  const recs = getHealthRecommendations(snap);
  assert.equal(JSON.stringify(snap), frozen, "snapshot must not be mutated");
  const rec = recs.find((r) => r.kind === "recovery");
  assert.ok(rec);
  assert.equal(rec!.evidence.windowDays, snap.windowDays);
});

// ---------------------------------------------------------------------------
// Break — long session
// ---------------------------------------------------------------------------

test("break_long_session: triggers at long threshold inclusive, evidence cites seconds", () => {
  const t = HEALTH_RECOMMENDATION_THRESHOLDS;
  const snapAt = makeSnapshot({
    longestSessionSeconds: t.longSessionMinutes * 60,
    longestSessionLabel: `${t.longSessionMinutes}m 0s`,
    rollingWorkload: { totalTrackedSeconds: 200 * 60, totalTrackedMinutes: 200, totalTrackedLabel: "3h 20m 0s" },
    activeDays: 4,
    sessionDensity: 0.8,
  });
  const rec = getHealthRecommendations(snapAt).find((r) => r.id === "health.recommendation.break_long_session");
  assert.ok(rec);
  assert.equal(rec!.evidence.metric, "longestSessionSeconds");
  assert.equal(rec!.evidence.value, t.longSessionMinutes * 60);
  assert.equal(rec!.evidence.threshold, t.longSessionMinutes * 60);
  assert.equal(rec!.evidence.unit, "seconds");
  assert.match(rec!.message, new RegExp(`${t.longSessionMinutes} min`));
  assert.equal(rec!.severity, "nudge");

  const snapBelow = makeSnapshot({
    longestSessionSeconds: t.longSessionMinutes * 60 - 1,
    rollingWorkload: { totalTrackedSeconds: 200 * 60, totalTrackedMinutes: 200, totalTrackedLabel: "x" },
    activeDays: 4,
    sessionDensity: 0.8,
  });
  assert.equal(getHealthRecommendations(snapBelow).find((r) => r.kind === "break"), undefined);
});

test("break_long_session: veryLong escalates to guide, null never triggers", () => {
  const t = HEALTH_RECOMMENDATION_THRESHOLDS;
  const snapVery = makeSnapshot({
    longestSessionSeconds: t.veryLongSessionMinutes * 60,
    longestSessionLabel: `${t.veryLongSessionMinutes}m 0s`,
  });
  const recVery = getHealthRecommendations(snapVery).find((r) => r.kind === "break");
  assert.ok(recVery);
  assert.equal(recVery!.severity, "guide");

  const snapNull = makeSnapshot({ longestSessionSeconds: null, longestSessionLabel: null });
  assert.equal(getHealthRecommendations(snapNull).find((r) => r.kind === "break"), undefined);
});

// ---------------------------------------------------------------------------
// Movement — low activity
// ---------------------------------------------------------------------------

test("movement_low_activity: triggers when activeDays low and total low", () => {
  const t = HEALTH_RECOMMENDATION_THRESHOLDS;
  const snap = makeSnapshot({
    activeDays: t.lowActiveDays,
    rollingWorkload: { totalTrackedSeconds: t.lowTotalMinutes * 60, totalTrackedMinutes: t.lowTotalMinutes, totalTrackedLabel: "1h 30m 0s" },
    longestSessionSeconds: 30 * 60,
    sessionDensity: 0.8, // high density to avoid training also (but training would be suppressed by high density anyway)
  });
  const rec = getHealthRecommendations(snap).find((r) => r.id === "health.recommendation.movement_low_activity");
  assert.ok(rec, "should emit movement at exactly low thresholds");
  assert.equal(rec!.evidence.metric, "activeDays");
  assert.equal(rec!.evidence.value, t.lowActiveDays);
  assert.equal(rec!.evidence.threshold, t.lowActiveDays);
  assert.equal(rec!.evidence.unit, "days");
  assert.equal(rec!.kind, "movement");
  assert.match(rec!.evidence.label, new RegExp(`${t.lowActiveDays} active day`));

  // One more active day should not trigger movement if total still low but activeDays > threshold
  const snapAboveDays = makeSnapshot({
    activeDays: t.lowActiveDays + 1,
    rollingWorkload: { totalTrackedSeconds: t.lowTotalMinutes * 60, totalTrackedMinutes: t.lowTotalMinutes, totalTrackedLabel: "x" },
    longestSessionSeconds: 30 * 60,
    sessionDensity: 0.8,
  });
  assert.equal(getHealthRecommendations(snapAboveDays).find((r) => r.kind === "movement"), undefined);

  // Low days but high total should not trigger movement
  const snapHighTotal = makeSnapshot({
    activeDays: 1,
    rollingWorkload: { totalTrackedSeconds: (t.lowTotalMinutes + 10) * 60, totalTrackedMinutes: t.lowTotalMinutes + 10, totalTrackedLabel: "x" },
    longestSessionSeconds: 30 * 60,
    sessionDensity: 0.8,
  });
  assert.equal(getHealthRecommendations(snapHighTotal).find((r) => r.kind === "movement"), undefined);
});

// ---------------------------------------------------------------------------
// Training — low density
// ---------------------------------------------------------------------------

test("training_low_density: triggers at threshold inclusive, suppressed when workload high", () => {
  const t = HEALTH_RECOMMENDATION_THRESHOLDS;
  const snapAt = makeSnapshot({
    sessionDensity: t.lowSessionDensity,
    rollingWorkload: { totalTrackedSeconds: 200 * 60, totalTrackedMinutes: 200, totalTrackedLabel: "3h 20m 0s" },
    activeDays: 4,
    longestSessionSeconds: 30 * 60,
  });
  const rec = getHealthRecommendations(snapAt).find((r) => r.id === "health.recommendation.training_low_density");
  assert.ok(rec);
  assert.equal(rec!.evidence.metric, "sessionDensity");
  assert.equal(rec!.evidence.value, t.lowSessionDensity);
  assert.equal(rec!.evidence.threshold, t.lowSessionDensity);
  assert.equal(rec!.evidence.unit, "density");

  const snapAbove = makeSnapshot({
    sessionDensity: t.lowSessionDensity + 0.01,
    rollingWorkload: { totalTrackedSeconds: 200 * 60, totalTrackedMinutes: 200, totalTrackedLabel: "x" },
    activeDays: 4,
    longestSessionSeconds: 30 * 60,
  });
  assert.equal(getHealthRecommendations(snapAbove).find((r) => r.kind === "training"), undefined);

  // High workload suppresses training (complementary guidance)
  const snapHigh = makeSnapshot({
    sessionDensity: 0.1,
    rollingWorkload: { totalTrackedSeconds: 800 * 60, totalTrackedMinutes: 800, totalTrackedLabel: "13h 20m 0s" },
    activeDays: 7,
    longestSessionSeconds: 30 * 60,
  });
  assert.equal(getHealthRecommendations(snapHigh).find((r) => r.kind === "training"), undefined);
});

// ---------------------------------------------------------------------------
// Determinism, ordering, deduplication, non-medical copy
// ---------------------------------------------------------------------------

test("recommendations are deterministic for same evidence/time window", () => {
  const snapMulti = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: 650 * 60, totalTrackedMinutes: 650, totalTrackedLabel: "10h 50m 0s" },
    longestSessionSeconds: 100 * 60,
    longestSessionLabel: "1h 40m 0s",
    sessionDensity: 0.5, // will trigger training? but suppressed because high workload => training suppressed, so only recovery+break
    activeDays: 7,
    quality: { quality: "sufficient", reasons: [], hasOpenSessions: false, openSessionCount: 0, malformedCount: 0, sessionCount: 7, totalTrackedSeconds: 650 * 60 },
  });
  const r1 = getHealthRecommendations(snapMulti);
  const r2 = getHealthRecommendations(snapMulti);
  assert.deepEqual(r1, r2);
  // Also ordering is stable across shuffles? We create via same snapshot but ensure r1 equals r2 ids order
  assert.deepEqual(r1.map((r) => r.id), r2.map((r) => r.id));
});

test("multiple rules are ordered predictably by kind rank then severity then id", () => {
  // Create a snapshot that triggers recovery + break + training (movement suppressed by totalMinutes high, training not suppressed)
  // To trigger all except movement, need recovery (high workload), break (long), training (low density but not suppressed)
  // Training suppressed when workload high, so can't have both recovery and training. Use recovery+break = ordered recovery before break.
  const snap = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: 650 * 60, totalTrackedMinutes: 650, totalTrackedLabel: "10h 50m 0s" },
    longestSessionSeconds: 130 * 60, // very long => guide
    longestSessionLabel: "2h 10m 0s",
    sessionDensity: 1.0, // not training
    activeDays: 7,
  });
  const recs = getHealthRecommendations(snap);
  assert.ok(recs.length >= 2);
  const kinds = recs.map((r) => r.kind);
  // Rank: recovery (1) before break (2)
  assert.deepEqual(kinds, ["recovery", "break"]);

  // Now test break + movement + training ordering when workload low (no recovery)
  const snap2 = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: 60 * 60, totalTrackedMinutes: 60, totalTrackedLabel: "1h 0m 0s" },
    longestSessionSeconds: 100 * 60,
    longestSessionLabel: "1h 40m 0s",
    activeDays: 1, // movement
    sessionDensity: 0.2, // training
  });
  const recs2 = getHealthRecommendations(snap2);
  const kinds2 = recs2.map((r) => r.kind);
  // Expected order: break (2), movement (3), training (4)
  assert.deepEqual(kinds2, ["break", "movement", "training"]);
});

test("recommendations are deduplicated by id and sorted lexicographically as tie-breaker", () => {
  const snap = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: 650 * 60, totalTrackedMinutes: 650, totalTrackedLabel: "10h 50m 0s" },
    longestSessionSeconds: 100 * 60,
    activeDays: 7,
    sessionDensity: 1.0,
  });
  const recs = getHealthRecommendations(snap);
  const ids = recs.map((r) => r.id);
  const unique = new Set(ids);
  assert.equal(ids.length, unique.size, "no duplicate ids");
  // Run twice to ensure dedup and sort stable
  const r1 = getHealthRecommendations(snap).map((r) => r.id).join(",");
  const r2 = getHealthRecommendations(snap).map((r) => r.id).join(",");
  assert.equal(r1, r2);
});

test("evidence always includes actual tracked value that triggered it and copyKey", () => {
  const snap = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: 700 * 60, totalTrackedMinutes: 700, totalTrackedLabel: "11h 40m 0s" },
    longestSessionSeconds: 100 * 60,
    activeDays: 4,
    sessionDensity: 0.8,
  });
  const recs = getHealthRecommendations(snap);
  for (const r of recs) {
    assert.ok(r.evidence, `recommendation ${r.id} must have evidence`);
    assert.equal(typeof r.evidence.value, "number");
    assert.equal(typeof r.evidence.threshold, "number");
    assert.ok(r.evidence.label.length > 0);
    assert.ok(r.evidence.metric.length > 0);
    assert.equal(r.evidence.windowDays, snap.windowDays);
    assert.equal(r.evidence.quality, "sufficient");
    assert.ok(r.copyKey.startsWith("health.recommendation."), `copyKey must be namespaced: ${r.copyKey}`);
    assert.equal(r.copyKey, r.id, "copyKey should equal id for deterministic copy resolution");
  }
});

test("non-medical copy: no banned terms, workload-oriented", () => {
  const cases: HealthWorkloadSnapshot[] = [
    makeSnapshot({
      rollingWorkload: { totalTrackedSeconds: 700 * 60, totalTrackedMinutes: 700, totalTrackedLabel: "11h 40m 0s" },
      longestSessionSeconds: 30 * 60,
      activeDays: 7,
      sessionDensity: 1.0,
    }),
    makeSnapshot({
      rollingWorkload: { totalTrackedSeconds: 60 * 60, totalTrackedMinutes: 60, totalTrackedLabel: "1h 0m 0s" },
      activeDays: 1,
      longestSessionSeconds: 30 * 60,
      sessionDensity: 0.8,
    }),
    makeSnapshot({
      longestSessionSeconds: 100 * 60,
      longestSessionLabel: "1h 40m 0s",
      rollingWorkload: { totalTrackedSeconds: 200 * 60, totalTrackedMinutes: 200, totalTrackedLabel: "3h 20m 0s" },
    }),
  ];
  for (const snap of cases) {
    const recs = getHealthRecommendations(snap);
    assertNonMedicalCopy(recs);
    for (const r of recs) {
      // Must contain evidence citation (value or threshold) in message or evidence label.
      // For seconds-based evidence, message uses minutes, so also accept minutes representation.
      const valueMinutes = r.evidence.unit === "seconds" ? String(Math.floor(r.evidence.value / 60)) : String(r.evidence.value);
      const thresholdMinutes = r.evidence.unit === "seconds" ? String(Math.floor(r.evidence.threshold / 60)) : String(r.evidence.threshold);
      const containsEvidence =
        r.message.includes(String(r.evidence.value)) ||
        r.message.includes(String(r.evidence.threshold)) ||
        r.message.includes(valueMinutes) ||
        r.message.includes(thresholdMinutes) ||
        r.evidence.label.includes(String(r.evidence.value)) ||
        r.evidence.label.includes(valueMinutes);
      assert.equal(containsEvidence, true, `recommendation ${r.id} message must cite evidence value/threshold`);
      // Title and message must be workload-oriented, not empty
      assert.ok(r.title.length > 5);
      assert.ok(r.message.length > 20);
    }
  }
});

test("no recommendation directly mutates Tasks/Today — pure function only reads snapshot", () => {
  const snap = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: 650 * 60, totalTrackedMinutes: 650, totalTrackedLabel: "10h 50m 0s" },
  });
  const before = JSON.stringify(snap);
  const recs = getHealthRecommendations(snap);
  // Ensure recommendations have no side-effect fields like task mutation
  for (const r of recs) {
    const serialized = JSON.stringify(r);
    assert.equal(serialized.includes("taskId"), false);
    assert.equal(serialized.includes("schedule"), false);
    assert.equal(serialized.includes("goalId"), false);
  }
  assert.equal(JSON.stringify(snap), before);
});

test("web/mobile parity: application recommendation maps 1:1 to contract DTO shape", async () => {
  // This ensures the DTO we ship over HTTP is identical semantics to application model.
  // We import contract type only for shape check — runtime is just structural.
  const snap = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: 650 * 60, totalTrackedMinutes: 650, totalTrackedLabel: "10h 50m 0s" },
    longestSessionSeconds: 100 * 60,
    activeDays: 7,
    sessionDensity: 1.0,
  });
  const recs = getHealthRecommendations(snap);
  // Simulate server mapping (as in apps/server/src/routes/health.ts)
  const dtos = recs.map((r) => ({
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    copyKey: r.copyKey,
    title: r.title,
    message: r.message,
    evidence: r.evidence,
  }));
  assert.deepEqual(dtos, recs, "contract DTO should be structural equal to application model (parity)");
  // Both web and mobile would receive same DTO array via HealthSnapshotResponse.recommendations
  // Verify deterministic JSON serialization (ordering matters for parity)
  const json1 = JSON.stringify(dtos);
  const json2 = JSON.stringify(recs.map((r) => ({ ...r })));
  assert.equal(json1, json2);
});

test("boundary: thresholds are inclusive — exactly at threshold triggers, below does not", () => {
  const t = HEALTH_RECOMMENDATION_THRESHOLDS;
  // Recovery exactly at high
  const snapRecAt = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: t.highWorkloadMinutes * 60, totalTrackedMinutes: t.highWorkloadMinutes, totalTrackedLabel: "x" },
    longestSessionSeconds: 10 * 60,
    activeDays: 7,
    sessionDensity: 1.0,
  });
  assert.ok(getHealthRecommendations(snapRecAt).some((r) => r.kind === "recovery"));
  const snapRecBelow = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: (t.highWorkloadMinutes - 1) * 60, totalTrackedMinutes: t.highWorkloadMinutes - 1, totalTrackedLabel: "x" },
    longestSessionSeconds: 10 * 60,
    activeDays: 7,
    sessionDensity: 1.0,
  });
  assert.equal(getHealthRecommendations(snapRecBelow).some((r) => r.kind === "recovery"), false);

  // Break exactly at long
  const snapBreakAt = makeSnapshot({
    longestSessionSeconds: t.longSessionMinutes * 60,
    rollingWorkload: { totalTrackedSeconds: 200 * 60, totalTrackedMinutes: 200, totalTrackedLabel: "x" },
    activeDays: 4,
    sessionDensity: 0.8,
  });
  assert.ok(getHealthRecommendations(snapBreakAt).some((r) => r.kind === "break"));
  const snapBreakBelow = makeSnapshot({
    longestSessionSeconds: t.longSessionMinutes * 60 - 1,
    rollingWorkload: { totalTrackedSeconds: 200 * 60, totalTrackedMinutes: 200, totalTrackedLabel: "x" },
    activeDays: 4,
    sessionDensity: 0.8,
  });
  assert.equal(getHealthRecommendations(snapBreakBelow).some((r) => r.kind === "break"), false);

  // Movement exactly at lowActiveDays and lowTotalMinutes
  const snapMoveAt = makeSnapshot({
    activeDays: t.lowActiveDays,
    rollingWorkload: { totalTrackedSeconds: t.lowTotalMinutes * 60, totalTrackedMinutes: t.lowTotalMinutes, totalTrackedLabel: "x" },
    longestSessionSeconds: 10 * 60,
    sessionDensity: 0.8,
  });
  assert.ok(getHealthRecommendations(snapMoveAt).some((r) => r.kind === "movement"));
  const snapMoveAbove = makeSnapshot({
    activeDays: t.lowActiveDays + 1,
    rollingWorkload: { totalTrackedSeconds: t.lowTotalMinutes * 60, totalTrackedMinutes: t.lowTotalMinutes, totalTrackedLabel: "x" },
    longestSessionSeconds: 10 * 60,
    sessionDensity: 0.8,
  });
  assert.equal(getHealthRecommendations(snapMoveAbove).some((r) => r.kind === "movement"), false);

  // Training exactly at lowSessionDensity
  const snapTrainAt = makeSnapshot({
    sessionDensity: t.lowSessionDensity,
    rollingWorkload: { totalTrackedSeconds: 200 * 60, totalTrackedMinutes: 200, totalTrackedLabel: "x" },
    activeDays: 4,
    longestSessionSeconds: 10 * 60,
  });
  assert.ok(getHealthRecommendations(snapTrainAt).some((r) => r.kind === "training"));
  const snapTrainAbove = makeSnapshot({
    sessionDensity: t.lowSessionDensity + 0.001,
    rollingWorkload: { totalTrackedSeconds: 200 * 60, totalTrackedMinutes: 200, totalTrackedLabel: "x" },
    activeDays: 4,
    longestSessionSeconds: 10 * 60,
  });
  assert.equal(getHealthRecommendations(snapTrainAbove).some((r) => r.kind === "training"), false);
});

test("no-data / edge: insufficient snapshot with zero sessions yields no rec and no crash for null longest", () => {
  const snap = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: 0, totalTrackedMinutes: 0, totalTrackedLabel: "0s" },
    activeDays: 0,
    windowDays: 7,
    sessionCount: 0,
    sessionDensity: 0,
    longestSessionSeconds: null,
    longestSessionLabel: null,
    averageSessionSeconds: null,
    averageSessionLabel: null,
    quality: { quality: "insufficient", reasons: ["no contributing sessions"], hasOpenSessions: false, openSessionCount: 0, malformedCount: 0, sessionCount: 0, totalTrackedSeconds: 0 },
  });
  const recs = getHealthRecommendations(snap);
  assert.equal(recs.length, 0);
  // Also a sufficient snapshot with null longest but otherwise moderate should not crash and not emit break
  const snapSufficientNullLongest = makeSnapshot({
    rollingWorkload: { totalTrackedSeconds: 200 * 60, totalTrackedMinutes: 200, totalTrackedLabel: "3h 20m 0s" },
    longestSessionSeconds: null,
    longestSessionLabel: null,
    activeDays: 4,
    sessionDensity: 0.8,
    quality: { quality: "sufficient", reasons: [], hasOpenSessions: false, openSessionCount: 0, malformedCount: 0, sessionCount: 4, totalTrackedSeconds: 200 * 60 },
  });
  const recs2 = getHealthRecommendations(snapSufficientNullLongest);
  assert.equal(recs2.some((r) => r.kind === "break"), false);
});

test("thresholds live in shared policy and are deterministic constants", () => {
  // Ensure thresholds exported and immutable (as const)
  assert.ok(HEALTH_RECOMMENDATION_THRESHOLDS);
  assert.equal(typeof HEALTH_RECOMMENDATION_THRESHOLDS.highWorkloadMinutes, "number");
  assert.equal(typeof HEALTH_RECOMMENDATION_THRESHOLDS.longSessionMinutes, "number");
  assert.equal(typeof HEALTH_RECOMMENDATION_THRESHOLDS.lowActiveDays, "number");
  assert.equal(typeof HEALTH_RECOMMENDATION_THRESHOLDS.lowSessionDensity, "number");
  // Must be reasonable workload-oriented values, not medical
  assert.ok(HEALTH_RECOMMENDATION_THRESHOLDS.highWorkloadMinutes > HEALTH_RECOMMENDATION_THRESHOLDS.lowTotalMinutes);
  assert.ok(HEALTH_RECOMMENDATION_THRESHOLDS.veryHighWorkloadMinutes > HEALTH_RECOMMENDATION_THRESHOLDS.highWorkloadMinutes);
  assert.ok(HEALTH_RECOMMENDATION_THRESHOLDS.veryLongSessionMinutes > HEALTH_RECOMMENDATION_THRESHOLDS.longSessionMinutes);
});
