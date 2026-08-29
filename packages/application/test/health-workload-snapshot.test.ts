import assert from "node:assert/strict";
import test from "node:test";

import {
  getHealthWorkloadSnapshot,
  HEALTH_ROLLING_WINDOW_DAYS,
  type HealthWorkloadSnapshot,
} from "../src/health/workload-snapshot";
import type { AuthenticatedActor } from "../src/auth/actor";
import type { ExecutionEvidenceSessionRow, ExecutionEvidenceWindow } from "../src/shared/execution-evidence";
import type { TimeContextRepository } from "../src/shared/time-context";
import type { ExecutionEvidenceRepository } from "../src/shared/execution-evidence";

const ACTOR: AuthenticatedActor = { userId: "user-health-1" };

function makeTimeRepo(timezone: string | null): TimeContextRepository {
  return {
    async getTimezone() {
      return { ok: true as const, value: timezone };
    },
    async setTimezone(_actor, tz) {
      return { ok: true as const, value: tz };
    },
  };
}

function makeEvidenceRepo(
  sessions: ExecutionEvidenceSessionRow[],
  captureWindow?: { value: ExecutionEvidenceWindow | null },
): ExecutionEvidenceRepository {
  return {
    async listSessionsForWindow(_actor, window) {
      if (captureWindow) captureWindow.value = window;
      return { ok: true as const, value: sessions };
    },
  };
}

function row(overrides: Partial<ExecutionEvidenceSessionRow> & { task_id: string; started_at: string }): ExecutionEvidenceSessionRow {
  return {
    ended_at: "2026-04-20T10:00:00.000Z",
    duration_seconds: null,
    tasks: null,
    ...overrides,
  } as ExecutionEvidenceSessionRow;
}

// ---------------------------------------------------------------------------
// Metrics derive from owner-scoped Task sessions; no wearable data
// ---------------------------------------------------------------------------

test("rolling workload, active days, density, longest/avg derive from sessions", async () => {
  const now = new Date("2026-04-20T12:00:00.000Z");
  // Health window for 2026-04-20 local UTC is 2026-04-14..2026-04-21 exclusive (7 days)
  const sessions: ExecutionEvidenceSessionRow[] = [
    row({ task_id: "t1", started_at: "2026-04-19T09:00:00.000Z", ended_at: "2026-04-19T10:00:00.000Z", tasks: { id: "t1", title: "T1" } }),
    row({ task_id: "t2", started_at: "2026-04-19T11:00:00.000Z", ended_at: "2026-04-19T11:30:00.000Z", tasks: { id: "t2", title: "T2" } }),
    row({ task_id: "t3", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:15:00.000Z", tasks: { id: "t3", title: "T3" } }),
  ];
  const snapshotResult = await getHealthWorkloadSnapshot(ACTOR, makeTimeRepo("UTC"), makeEvidenceRepo(sessions), { now });
  assert.equal(snapshotResult.ok, true);
  const snap = (snapshotResult as { ok: true; data: HealthWorkloadSnapshot }).data;
  assert.equal(snap.windowDays, 7);
  assert.equal(snap.sessionCount, 3);
  // total = 1h + 0.5h + 0.25h = 6300s
  assert.equal(snap.rollingWorkload.totalTrackedSeconds, 6300);
  assert.equal(snap.rollingWorkload.totalTrackedMinutes, 105);
  // activeDays = distinct UTC days with sessions = 2 (19,20)
  assert.equal(snap.activeDays, 2);
  // density = 3 /7 = 0.43
  assert.equal(snap.sessionDensity, 0.43);
  assert.equal(snap.longestSessionSeconds, 3600);
  assert.equal(snap.averageSessionSeconds, 2100);
  assert.equal(snap.longestSessionLabel, "1h 0m 0s");
  assert.equal(snap.averageSessionLabel, "35m 0s");
  assert.equal(snap.quality.quality, "sufficient");
});

test("active days follow Tokyo local midnights while the equivalent New York instant stays on one day", async () => {
  const session = row({
    task_id: "t-midnight",
    started_at: "2026-04-20T14:30:00.000Z",
    ended_at: "2026-04-20T15:30:00.000Z",
  });

  const tokyoResult = await getHealthWorkloadSnapshot(
    ACTOR,
    makeTimeRepo("Asia/Tokyo"),
    makeEvidenceRepo([session]),
    { now: new Date("2026-04-20T16:00:00.000Z") },
  );
  const newYorkResult = await getHealthWorkloadSnapshot(
    ACTOR,
    makeTimeRepo("America/New_York"),
    makeEvidenceRepo([session]),
    { now: new Date("2026-04-20T16:00:00.000Z") },
  );

  assert.equal(tokyoResult.ok, true);
  assert.equal(newYorkResult.ok, true);
  assert.equal((tokyoResult as { ok: true; data: HealthWorkloadSnapshot }).data.activeDays, 2);
  assert.equal((newYorkResult as { ok: true; data: HealthWorkloadSnapshot }).data.activeDays, 1);
});

test("active days treat the New York DST spring transition as one 23-hour local day", async () => {
  const result = await getHealthWorkloadSnapshot(
    ACTOR,
    makeTimeRepo("America/New_York"),
    makeEvidenceRepo([
      row({
        task_id: "t-spring",
        started_at: "2026-03-08T05:00:00.000Z",
        ended_at: "2026-03-09T04:00:00.000Z",
      }),
    ]),
    { now: new Date("2026-03-09T03:59:59.000Z") },
  );

  assert.equal(result.ok, true);
  const snapshot = (result as { ok: true; data: HealthWorkloadSnapshot }).data;
  assert.equal(snapshot.rollingWorkload.totalTrackedSeconds, 82_800);
  assert.equal(snapshot.activeDays, 1);
});

test("active days treat the New York DST fall transition as one 25-hour local day", async () => {
  const result = await getHealthWorkloadSnapshot(
    ACTOR,
    makeTimeRepo("America/New_York"),
    makeEvidenceRepo([
      row({
        task_id: "t-fall",
        started_at: "2026-11-01T04:00:00.000Z",
        ended_at: "2026-11-02T05:00:00.000Z",
      }),
    ]),
    { now: new Date("2026-11-02T04:59:59.000Z") },
  );

  assert.equal(result.ok, true);
  const snapshot = (result as { ok: true; data: HealthWorkloadSnapshot }).data;
  assert.equal(snapshot.rollingWorkload.totalTrackedSeconds, 90_000);
  assert.equal(snapshot.activeDays, 1);
});

test("included open sessions contribute to every overlapped local day", async () => {
  const result = await getHealthWorkloadSnapshot(
    ACTOR,
    makeTimeRepo("Asia/Tokyo"),
    makeEvidenceRepo([
      {
        task_id: "t-open-midnight",
        started_at: "2026-04-20T14:30:00.000Z",
        ended_at: null,
        duration_seconds: null,
        tasks: null,
      },
    ]),
    {
      now: new Date("2026-04-20T15:30:00.000Z"),
      includeOpenSessions: true,
    },
  );

  assert.equal(result.ok, true);
  const snapshot = (result as { ok: true; data: HealthWorkloadSnapshot }).data;
  assert.equal(snapshot.rollingWorkload.totalTrackedSeconds, 3_600);
  assert.equal(snapshot.activeDays, 2);
  assert.equal(snapshot.quality.quality, "provisional");
});

test("local active-day evidence clips sessions to the health evidence window", async () => {
  const result = await getHealthWorkloadSnapshot(
    ACTOR,
    makeTimeRepo("Asia/Tokyo"),
    makeEvidenceRepo([
      row({
        task_id: "t-clipped",
        started_at: "2026-04-14T14:30:00.000Z",
        ended_at: "2026-04-14T15:30:00.000Z",
      }),
    ]),
    { now: new Date("2026-04-20T16:00:00.000Z") },
  );

  assert.equal(result.ok, true);
  const snapshot = (result as { ok: true; data: HealthWorkloadSnapshot }).data;
  assert.equal(snapshot.window.startIso, "2026-04-14T15:00:00.000Z");
  assert.equal(snapshot.rollingWorkload.totalTrackedSeconds, 1_800);
  assert.equal(snapshot.activeDays, 1);
});

test("local active-day aggregation is independent of the server process timezone", async () => {
  const originalTimezone = process.env.TZ;
  const session = row({
    task_id: "t-process-tz",
    started_at: "2026-04-20T14:30:00.000Z",
    ended_at: "2026-04-20T15:30:00.000Z",
  });

  try {
    process.env.TZ = "America/Los_Angeles";
    const losAngelesProcess = await getHealthWorkloadSnapshot(
      ACTOR,
      makeTimeRepo("Asia/Tokyo"),
      makeEvidenceRepo([session]),
      { now: new Date("2026-04-20T16:00:00.000Z") },
    );

    process.env.TZ = "UTC";
    const utcProcess = await getHealthWorkloadSnapshot(
      ACTOR,
      makeTimeRepo("Asia/Tokyo"),
      makeEvidenceRepo([session]),
      { now: new Date("2026-04-20T16:00:00.000Z") },
    );

    assert.equal(losAngelesProcess.ok, true);
    assert.equal(utcProcess.ok, true);
    assert.equal(
      (losAngelesProcess as { ok: true; data: HealthWorkloadSnapshot }).data.activeDays,
      2,
    );
    assert.equal(
      (utcProcess as { ok: true; data: HealthWorkloadSnapshot }).data.activeDays,
      2,
    );
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("snapshot includes evidence quality for UI to distinguish insufficient vs zero vs provisional vs suspect", async () => {
  const now = new Date("2026-04-20T12:00:00.000Z");

  // insufficient: no sessions
  const insufficient = await getHealthWorkloadSnapshot(ACTOR, makeTimeRepo("UTC"), makeEvidenceRepo([]), { now });
  assert.equal(insufficient.ok, true);
  assert.equal((insufficient as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality, "insufficient");
  assert.equal((insufficient as unknown as { data: HealthWorkloadSnapshot }).data.sessionCount, 0);
  assert.equal((insufficient as unknown as { data: HealthWorkloadSnapshot }).data.activeDays, 0);
  assert.equal((insufficient as unknown as { data: HealthWorkloadSnapshot }).data.longestSessionSeconds, null);
  assert.equal((insufficient as unknown as { data: HealthWorkloadSnapshot }).data.averageSessionSeconds, null);

  // sufficient: closed sessions
  const sufficient = await getHealthWorkloadSnapshot(
    ACTOR,
    makeTimeRepo("UTC"),
    makeEvidenceRepo([row({ task_id: "t1", started_at: "2026-04-19T09:00:00.000Z", ended_at: "2026-04-19T10:00:00.000Z" })]),
    { now },
  );
  assert.equal((sufficient as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality, "sufficient");

  // provisional: open session included
  const provisional = await getHealthWorkloadSnapshot(
    ACTOR,
    makeTimeRepo("UTC"),
    makeEvidenceRepo([{ task_id: "t-open", started_at: "2026-04-20T11:00:00.000Z", ended_at: null, duration_seconds: null, tasks: null }]),
    { now, includeOpenSessions: true },
  );
  assert.equal((provisional as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality, "provisional");
  assert.equal((provisional as unknown as { data: HealthWorkloadSnapshot }).data.quality.hasOpenSessions, true);
  assert.equal((provisional as unknown as { data: HealthWorkloadSnapshot }).data.quality.openSessionCount, 1);
  assert.equal((provisional as unknown as { data: HealthWorkloadSnapshot }).data.sessionCount, 1);

  // suspect: malformed
  const suspect = await getHealthWorkloadSnapshot(
    ACTOR,
    makeTimeRepo("UTC"),
    makeEvidenceRepo([row({ task_id: "bad", started_at: "not-a-date", ended_at: "2026-04-20T10:00:00.000Z" })]),
    { now, includeOpenSessions: true },
  );
  assert.equal((suspect as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality, "suspect");
  assert.equal((suspect as unknown as { data: HealthWorkloadSnapshot }).data.quality.malformedCount, 1);
});

test("open sessions excluded by default (consistent with shared policy)", async () => {
  const now = new Date("2026-04-20T12:00:00.000Z");
  const open: ExecutionEvidenceSessionRow = { task_id: "t-open", started_at: "2026-04-20T11:00:00.000Z", ended_at: null, duration_seconds: null, tasks: null };

  const excluded = await getHealthWorkloadSnapshot(ACTOR, makeTimeRepo("UTC"), makeEvidenceRepo([open]), { now });
  assert.equal(excluded.ok, true);
  assert.equal((excluded as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality, "insufficient");
  assert.equal((excluded as unknown as { data: HealthWorkloadSnapshot }).data.sessionCount, 0);
  assert.equal((excluded as unknown as { data: HealthWorkloadSnapshot }).data.rollingWorkload.totalTrackedSeconds, 0);

  const included = await getHealthWorkloadSnapshot(ACTOR, makeTimeRepo("UTC"), makeEvidenceRepo([open]), { now, includeOpenSessions: true });
  assert.equal(included.ok, true);
  assert.equal((included as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality, "provisional");
  assert.equal((included as unknown as { data: HealthWorkloadSnapshot }).data.sessionCount, 1);
  assert.equal((included as unknown as { data: HealthWorkloadSnapshot }).data.rollingWorkload.totalTrackedSeconds, 3600);
});

test("window boundaries come from time-context local day window, not server process time", async () => {
  // Use a timezone where local date differs from UTC date at now
  // now = 2026-04-20T02:00:00Z -> in America/New_York it's 2026-04-19 22:00
  const now = new Date("2026-04-20T02:00:00.000Z");
  const capture: { value: ExecutionEvidenceWindow | null } = { value: null };
  const repo = makeEvidenceRepo([], capture);
  const result = await getHealthWorkloadSnapshot(ACTOR, makeTimeRepo("America/New_York"), repo, { now });
  assert.equal(result.ok, true);
  const snap = (result as unknown as { data: HealthWorkloadSnapshot }).data as HealthWorkloadSnapshot;
  // Local date in NY should be 2026-04-19
  assert.equal(snap.localDate, "2026-04-19");
  assert.equal(snap.timezone, "America/New_York");
  // Window should be 7 days inclusive of 2026-04-19 in NY time, not UTC 2026-04-20
  // Start = 2026-04-13 NY start, End = 2026-04-20 NY end (which is 2026-04-20 04:00Z)
  // Verify startIso is 13th NY start, not 14th UTC start
  // NY 2026-04-13 00:00 EDT = 2026-04-13T04:00:00Z
  assert.ok(capture.value !== null);
  assert.equal(capture.value!.startIso, "2026-04-13T04:00:00.000Z");
  assert.equal(capture.value!.endIso, "2026-04-20T04:00:00.000Z");
  // Verify window matches snapshot window
  assert.deepEqual(snap.window, capture.value);
});

test("suspect outranks provisional when both malformed and open", async () => {
  const now = new Date("2026-04-20T12:00:00.000Z");
  const sessions: ExecutionEvidenceSessionRow[] = [
    row({ task_id: "t-good", started_at: "2026-04-19T09:00:00.000Z", ended_at: "2026-04-19T09:30:00.000Z" }),
    row({ task_id: "t-bad", started_at: "bad", ended_at: "2026-04-19T10:00:00.000Z" }),
    { task_id: "t-open", started_at: "2026-04-20T11:00:00.000Z", ended_at: null, duration_seconds: null, tasks: null },
  ];
  const result = await getHealthWorkloadSnapshot(ACTOR, makeTimeRepo("UTC"), makeEvidenceRepo(sessions), { now, includeOpenSessions: true });
  assert.equal(result.ok, true);
  assert.equal((result as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality, "suspect");
});

test("window clipping respects local day boundaries — sessions outside window not counted", async () => {
  const now = new Date("2026-04-20T12:00:00.000Z");
  const sessions: ExecutionEvidenceSessionRow[] = [
    row({ task_id: "t-outside", started_at: "2026-04-10T09:00:00.000Z", ended_at: "2026-04-10T10:00:00.000Z" }), // before 14th
    row({ task_id: "t-inside", started_at: "2026-04-19T09:00:00.000Z", ended_at: "2026-04-19T10:00:00.000Z" }),
  ];
  const result = await getHealthWorkloadSnapshot(ACTOR, makeTimeRepo("UTC"), makeEvidenceRepo(sessions), { now });
  assert.equal(result.ok, true);
  assert.equal((result as unknown as { data: HealthWorkloadSnapshot }).data.sessionCount, 1);
  assert.equal((result as unknown as { data: HealthWorkloadSnapshot }).data.rollingWorkload.totalTrackedSeconds, 3600);
});

test("requestedTimezone overrides stored timezone via shared time-context", async () => {
  const now = new Date("2026-04-20T12:00:00.000Z");
  const capture: { value: ExecutionEvidenceWindow | null } = { value: null };
  const repo = makeEvidenceRepo([], capture);
  // Stored is UTC, requested is Tokyo
  const result = await getHealthWorkloadSnapshot(ACTOR, makeTimeRepo("UTC"), repo, {
    now,
    requestedTimezone: "Asia/Tokyo",
  });
  assert.equal(result.ok, true);
  const snap = (result as unknown as { data: HealthWorkloadSnapshot }).data as HealthWorkloadSnapshot;
  assert.equal(snap.timezone, "Asia/Tokyo");
  assert.equal(snap.requestedTimezone, "Asia/Tokyo");
  // Tokyo local date for now 2026-04-20T12:00Z is 2026-04-20 21:00 JST => localDate 2026-04-20
  assert.equal(snap.localDate, "2026-04-20");
  // Window should be Tokyo 7 days
  assert.equal(capture.value!.startIso, "2026-04-13T15:00:00.000Z"); // 2026-04-13 00:00 JST = 12th 15:00Z? Actually 2026-04-13T00:00 JST = 2026-04-12T15:00Z
  // Let's just verify timezone field
  assert.equal(snap.timezone, "Asia/Tokyo");
});

test("invalid requested timezone falls back to UTC with invalid_timezone fallback", async () => {
  const now = new Date("2026-04-20T12:00:00.000Z");
  const result = await getHealthWorkloadSnapshot(ACTOR, makeTimeRepo("UTC"), makeEvidenceRepo([]), {
    now,
    requestedTimezone: "Bad/Zone",
  });
  assert.equal(result.ok, true);
  const snap = (result as unknown as { data: HealthWorkloadSnapshot }).data as HealthWorkloadSnapshot;
  assert.equal(snap.timezone, "UTC");
  assert.equal(snap.fallback, "invalid_timezone");
});

test("health snapshot distinguishes insufficient from zero activity via quality", async () => {
  const now = new Date("2026-04-20T12:00:00.000Z");
  // Zero activity but window valid — insufficient
  const r1 = await getHealthWorkloadSnapshot(ACTOR, makeTimeRepo("UTC"), makeEvidenceRepo([]), { now });
  assert.equal((r1 as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality, "insufficient");
  // Zero activity due to malformed — suspect, not insufficient
  const r2 = await getHealthWorkloadSnapshot(
    ACTOR,
    makeTimeRepo("UTC"),
    makeEvidenceRepo([row({ task_id: "t", started_at: "bad", ended_at: "2026-04-20T10:00:00.000Z" })]),
    { now },
  );
  assert.equal((r2 as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality, "suspect");
  // Provisional with open session dominating — still provisional, not sufficient
  const r3 = await getHealthWorkloadSnapshot(
    ACTOR,
    makeTimeRepo("UTC"),
    makeEvidenceRepo([{ task_id: "t-open", started_at: "2026-04-14T00:00:00.000Z", ended_at: null, duration_seconds: null, tasks: null }]),
    { now, includeOpenSessions: true },
  );
  assert.equal((r3 as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality, "provisional");
  // Ensure recommendations can suppress themselves when not sufficient
  for (const r of [r1, r2, r3]) {
    const q = (r as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality;
    const canRecommend = q === "sufficient";
    assert.equal(canRecommend, false);
  }
  const sufficient = await getHealthWorkloadSnapshot(
    ACTOR,
    makeTimeRepo("UTC"),
    makeEvidenceRepo([row({ task_id: "t1", started_at: "2026-04-19T09:00:00.000Z", ended_at: "2026-04-19T10:00:00.000Z" })]),
    { now },
  );
  assert.equal((sufficient as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality, "sufficient");
  assert.equal((sufficient as unknown as { data: HealthWorkloadSnapshot }).data.quality.quality === "sufficient", true);
});

test("no new health database: snapshot fails gracefully when evidence repository fails", async () => {
  const failingRepo: ExecutionEvidenceRepository = {
    async listSessionsForWindow() {
      return { ok: false as const, error: { code: "unknown" } };
    },
  };
  const result = await getHealthWorkloadSnapshot(ACTOR, makeTimeRepo("UTC"), failingRepo, { now: new Date("2026-04-20T12:00:00.000Z") });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errorMessage, /Unable to load health snapshot/);
});

test("rolling workload window is always 7 days", async () => {
  const now = new Date("2026-04-20T12:00:00.000Z");
  const result = await getHealthWorkloadSnapshot(ACTOR, makeTimeRepo("UTC"), makeEvidenceRepo([]), { now });
  assert.equal(result.ok, true);
  const snap = (result as unknown as { data: HealthWorkloadSnapshot }).data as HealthWorkloadSnapshot;
  assert.equal(snap.windowDays, HEALTH_ROLLING_WINDOW_DAYS);
  assert.equal(snap.windowDays, 7);
  const startMs = new Date(snap.window.startIso).getTime();
  const endMs = new Date(snap.window.endIso).getTime();
  // Window should be 7 * 24h = 604800000 ms (local days may differ by DST, but UTC baseline is 7 days)
  // For UTC, it's exactly 7 days. For other TZ with DST, duration may be 167 or 169h but we test UTC case.
  assert.equal(endMs - startMs, 7 * 24 * 60 * 60 * 1000);
});
