import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor, type AuthenticatedActor } from "../src/auth/actor";
import type { RepositoryResult } from "../src/shared/result";
import {
  resolveEffectiveTimezone,
  resolveHistoricalTimeContext,
  resolveTimeContext,
  setTimeContextTimezone,
  type TimeContextRepository,
} from "../src/shared/time-context";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}
function fail(): RepositoryResult<never> {
  return { ok: false, error: { code: "unknown" } };
}

class FakeTimeContextRepo implements TimeContextRepository {
  constructor(
    private stored: string | null = null,
    private shouldFail = false,
    public lastSet: string | null = null,
  ) {}

  async getTimezone(actor: AuthenticatedActor): Promise<RepositoryResult<string | null>> {
    void actor;
    if (this.shouldFail) return fail();
    return ok(this.stored);
  }
  async setTimezone(actor: AuthenticatedActor, timezone: string): Promise<RepositoryResult<string>> {
    void actor;
    if (this.shouldFail) return fail();
    this.lastSet = timezone;
    this.stored = timezone;
    return ok(timezone);
  }
}

test("resolveTimeContext uses valid requestedTimezone over stored and ignores server TZ", async () => {
  const originalTz = process.env.TZ;
  try {
    process.env.TZ = "Asia/Tokyo";
    const actor = createAuthenticatedActor("user-1");
    const repo = new FakeTimeContextRepo("Asia/Tokyo");
    const result = await resolveTimeContext(actor, repo, {
      requestedTimezone: "America/New_York",
      now: new Date("2026-01-15T12:00:00.000Z"),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.timezone, "America/New_York");
    assert.equal(result.data.fallback, "none");
    assert.equal(result.data.localDate, "2026-01-15");
    assert.equal(result.data.dayWindow.startUtcIso, "2026-01-15T05:00:00.000Z");
    assert.equal(result.data.weekWindow.weekStart, "2026-01-12");
    process.env.TZ = "UTC";
    const result2 = await resolveTimeContext(actor, repo, {
      requestedTimezone: "America/New_York",
      now: new Date("2026-01-15T12:00:00.000Z"),
    });
    assert.deepEqual(result.data, result2.ok ? result2.data : null);
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test("resolveTimeContext invalid requested falls back to UTC with explicit flag and ignores stored", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo("America/New_York");
  const result = await resolveTimeContext(actor, repo, {
    requestedTimezone: "Bad/Zone",
    now: new Date("2026-01-15T12:00:00.000Z"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.timezone, "UTC");
  assert.equal(result.data.fallback, "invalid_timezone");
  assert.equal(result.data.requestedTimezone, "Bad/Zone");
  assert.equal(result.data.dayWindow.startUtcIso, "2026-01-15T00:00:00.000Z");
});

test("resolveTimeContext missing requested uses stored valid timezone", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo("Asia/Tokyo");
  const result = await resolveTimeContext(actor, repo, {
    now: new Date("2026-01-15T12:00:00.000Z"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.timezone, "Asia/Tokyo");
  assert.equal(result.data.fallback, "none");
  // 2026-01-15T12Z is 2026-01-15 21:00 in Tokyo, so local date still 2026-01-15
  assert.equal(result.data.localDate, "2026-01-15");
  assert.equal(result.data.dayWindow.startUtcIso, "2026-01-14T15:00:00.000Z");
});

test("resolveTimeContext missing requested and no stored falls back missing_timezone to UTC", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo(null);
  const result = await resolveTimeContext(actor, repo, {
    now: new Date("2026-01-15T12:00:00.000Z"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.timezone, "UTC");
  assert.equal(result.data.fallback, "missing_timezone");
  assert.equal(result.data.requestedTimezone, null);
});

test("resolveTimeContext missing requested with stored invalid falls back invalid_timezone", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo("Invalid/Zone");
  const result = await resolveTimeContext(actor, repo, {
    now: new Date("2026-01-15T12:00:00.000Z"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.timezone, "UTC");
  assert.equal(result.data.fallback, "invalid_timezone");
  assert.equal(result.data.requestedTimezone, "Invalid/Zone");
});

test("resolveTimeContext handles midnight boundary correctly", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo(null);
  // 04:59:59Z still previous day in NY
  const before = await resolveTimeContext(actor, repo, {
    requestedTimezone: "America/New_York",
    now: new Date("2026-01-15T04:59:59.000Z"),
  });
  assert.equal(before.ok && before.data.localDate, "2026-01-14");
  // 05:00:00Z is new day
  const at = await resolveTimeContext(actor, repo, {
    requestedTimezone: "America/New_York",
    now: new Date("2026-01-15T05:00:00.000Z"),
  });
  assert.equal(at.ok && at.data.localDate, "2026-01-15");
});

test("resolveTimeContext DST 23h and 25h windows", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo(null);
  const spring = await resolveTimeContext(actor, repo, {
    requestedTimezone: "America/New_York",
    now: new Date("2026-03-08T12:00:00.000Z"),
  });
  assert.equal(spring.ok && spring.data.dayWindow.durationHours, 23);
  assert.equal(spring.ok && spring.data.dayWindow.startUtcIso, "2026-03-08T05:00:00.000Z");
  assert.equal(spring.ok && spring.data.dayWindow.endUtcIso, "2026-03-09T04:00:00.000Z");

  const fall = await resolveTimeContext(actor, repo, {
    requestedTimezone: "America/New_York",
    now: new Date("2026-11-01T12:00:00.000Z"),
  });
  assert.equal(fall.ok && fall.data.dayWindow.durationHours, 25);
  assert.equal(fall.ok && fall.data.dayWindow.startUtcIso, "2026-11-01T04:00:00.000Z");
  assert.equal(fall.ok && fall.data.dayWindow.endUtcIso, "2026-11-02T05:00:00.000Z");
});

test("resolveHistoricalTimeContext reproducible after clock moves forward", async () => {
  const r1 = resolveHistoricalTimeContext({ timezone: "America/New_York", date: "2026-01-12" });
  // Simulate time moving forward: calling again with same explicit date must give same window
  const r2 = resolveHistoricalTimeContext({ timezone: "America/New_York", date: "2026-01-12" });
  assert.equal(r1.ok && r2.ok && r1.data.dayWindow.startUtcIso === r2.data.dayWindow.startUtcIso, true);
  assert.equal(r1.ok && r2.ok && r1.data.weekWindow.weekStart === r2.data.weekWindow.weekStart, true);
  // Historical week window explicit input not affected by now
  const historical = resolveHistoricalTimeContext({ timezone: "America/New_York", date: "2026-01-15" });
  assert.equal(historical.ok && historical.data.weekWindow.weekStart, "2026-01-12");
  assert.equal(historical.ok && historical.data.weekWindow.weekEnd, "2026-01-18");
  // Another date in same week yields same week window
  const sameWeek = resolveHistoricalTimeContext({ timezone: "America/New_York", date: "2026-01-18" });
  assert.equal(historical.ok && sameWeek.ok && historical.data.weekWindow.weekStartUtcIso === sameWeek.data.weekWindow.weekStartUtcIso, true);
});

test("resolveHistoricalTimeContext adjacent weeks no gaps", () => {
  const w1 = resolveHistoricalTimeContext({ timezone: "America/New_York", date: "2026-01-05" });
  const w2 = resolveHistoricalTimeContext({ timezone: "America/New_York", date: "2026-01-12" });
  assert.equal(w1.ok && w2.ok && w1.data.weekWindow.weekEndExclusiveUtcIso === w2.data.weekWindow.weekStartUtcIso, true);
});

test("resolveHistoricalTimeContext invalid/missing fallback", () => {
  const invalid = resolveHistoricalTimeContext({ timezone: "Bad/Zone", date: "2026-01-15" });
  assert.equal(invalid.ok && invalid.data.dayWindow.fallback, "invalid_timezone");
  assert.equal(invalid.ok && invalid.data.dayWindow.timezone, "UTC");

  const missing = resolveHistoricalTimeContext({ timezone: "", date: "2026-01-15" });
  assert.equal(missing.ok && missing.data.dayWindow.fallback, "missing_timezone");
});

test("resolveHistoricalTimeContext validates date", () => {
  const bad = resolveHistoricalTimeContext({ timezone: "UTC", date: "bad-date" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.errorMessage, /Date is invalid/);
});

test("scheduled Tasks crossing midnight respects window", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo(null);
  const result = await resolveTimeContext(actor, repo, {
    requestedTimezone: "America/New_York",
    now: new Date("2026-01-15T12:00:00.000Z"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const window = result.data.dayWindow;
  // Task scheduled at 04:59:59Z belongs to previous local day, not inside 2026-01-15 window
  const taskBefore = "2026-01-15T04:59:59.000Z";
  const taskInside = "2026-01-15T05:00:00.000Z";
  assert.equal(taskBefore >= window.startUtcIso && taskBefore < window.endUtcIso, false);
  assert.equal(taskInside >= window.startUtcIso && taskInside < window.endUtcIso, true);
});

test("web and mobile parity same timezone/date yields same window", async () => {
  const actor = createAuthenticatedActor("user-1");
  const webRepo = new FakeTimeContextRepo(null);
  const mobileRepo = new FakeTimeContextRepo(null);
  const tz = "America/New_York";
  const now = new Date("2026-03-08T12:00:00.000Z");
  const web = await resolveTimeContext(actor, webRepo, { requestedTimezone: tz, now });
  const mobile = await resolveTimeContext(actor, mobileRepo, { requestedTimezone: tz, now });
  assert.deepEqual(web, mobile);
});

test("setTimeContextTimezone validates and persists", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo(null);
  const okResult = await setTimeContextTimezone(actor, repo, { timezone: "America/New_York" });
  assert.equal(okResult.ok, true);
  if (okResult.ok) assert.equal(okResult.data, "America/New_York");
  assert.equal(repo.lastSet, "America/New_York");

  const invalid = await setTimeContextTimezone(actor, repo, { timezone: "Bad/Zone" });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.errorMessage, /Timezone is invalid/);

  const missing = await setTimeContextTimezone(actor, repo, { timezone: "" });
  assert.equal(missing.ok, false);
});

test("resolveTimeContext repository failure returns application failure", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo(null, true);
  const result = await resolveTimeContext(actor, repo, { now: new Date("2026-01-15T12:00:00.000Z") });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "unknown");
});

test("resolveTimeContext trims whitespace timezone", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo(null);
  const result = await resolveTimeContext(actor, repo, {
    requestedTimezone: "  UTC  ",
    now: new Date("2026-01-15T12:00:00.000Z"),
  });
  assert.equal(result.ok && result.data.timezone, "UTC");
  assert.equal(result.ok && result.data.fallback, "none");
});

// ---------------------------------------------------------------------------
// Shared helper: resolveEffectiveTimezone isolates timezone selection policy
// without "today" / now semantics (used by Weekly Review historical path)
// ---------------------------------------------------------------------------

test("resolveEffectiveTimezone valid requested overrides stored", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo("Asia/Tokyo");
  const result = await resolveEffectiveTimezone(actor, repo, "America/New_York");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.timezone, "America/New_York");
  assert.equal(result.data.requestedTimezone, "America/New_York");
  assert.equal(result.data.fallback, "none");
});

test("resolveEffectiveTimezone invalid requested falls back to UTC and preserves requested", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo("America/New_York");
  const result = await resolveEffectiveTimezone(actor, repo, "Bad/Zone");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.timezone, "UTC");
  assert.equal(result.data.fallback, "invalid_timezone");
  assert.equal(result.data.requestedTimezone, "Bad/Zone");
});

test("resolveEffectiveTimezone missing requested uses stored valid", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo("Asia/Tokyo");
  const result = await resolveEffectiveTimezone(actor, repo, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.timezone, "Asia/Tokyo");
  assert.equal(result.data.fallback, "none");
  assert.equal(result.data.requestedTimezone, null);
});

test("resolveEffectiveTimezone missing requested and no stored => missing_timezone UTC", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo(null);
  const result = await resolveEffectiveTimezone(actor, repo, null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.timezone, "UTC");
  assert.equal(result.data.fallback, "missing_timezone");
  assert.equal(result.data.requestedTimezone, null);
});

test("resolveEffectiveTimezone missing requested with stored invalid => invalid_timezone UTC", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo("Invalid/Zone");
  const result = await resolveEffectiveTimezone(actor, repo, "");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.timezone, "UTC");
  assert.equal(result.data.fallback, "invalid_timezone");
  assert.equal(result.data.requestedTimezone, "Invalid/Zone");
});

test("resolveEffectiveTimezone trims whitespace requested and stored", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repoValid = new FakeTimeContextRepo("  UTC  ");
  const r1 = await resolveEffectiveTimezone(actor, repoValid, "  Asia/Tokyo  ");
  assert.equal(r1.ok && r1.data.timezone, "Asia/Tokyo");
  assert.equal(r1.ok && r1.data.fallback, "none");
  // whitespace requested treated as missing -> uses trimmed stored valid
  const repoStoredTrim = new FakeTimeContextRepo("  Asia/Tokyo  ");
  const r2 = await resolveEffectiveTimezone(actor, repoStoredTrim, "   ");
  assert.equal(r2.ok && r2.data.timezone, "Asia/Tokyo");
  // invalid stored with whitespace
  const repoInvalidTrim = new FakeTimeContextRepo("  Bad/Zone  ");
  const r3 = await resolveEffectiveTimezone(actor, repoInvalidTrim, undefined);
  assert.equal(r3.ok && r3.data.fallback, "invalid_timezone");
  assert.equal(r3.ok && r3.data.requestedTimezone, "Bad/Zone");
});

test("resolveEffectiveTimezone non-string requested treated as missing and uses stored", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo("Asia/Tokyo");
  const result = await resolveEffectiveTimezone(actor, repo, 123 as unknown as string);
  assert.equal(result.ok && result.data.timezone, "Asia/Tokyo");
  const result2 = await resolveEffectiveTimezone(actor, repo, {} as unknown as string);
  assert.equal(result2.ok && result2.data.timezone, "Asia/Tokyo");
});

test("resolveEffectiveTimezone repository failure returns application failure", async () => {
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo(null, true);
  const result = await resolveEffectiveTimezone(actor, repo, undefined);
  assert.equal(result.ok, false);
});

test("resolveEffectiveTimezone explicit override works for historical review without now", async () => {
  // This proves historical path can resolve timezone without depending on current wall-clock day
  const actor = createAuthenticatedActor("user-1");
  const repo = new FakeTimeContextRepo("America/New_York");
  const r1 = await resolveEffectiveTimezone(actor, repo, "Asia/Tokyo");
  assert.equal(r1.ok && r1.data.timezone, "Asia/Tokyo");
  // Same call must be reproducible regardless of now – helper is pure timezone policy
  const r2 = await resolveEffectiveTimezone(actor, repo, "Asia/Tokyo");
  assert.deepEqual(r1, r2);
  // Missing explicit should fall back to stored without needing now
  const r3 = await resolveEffectiveTimezone(actor, repo, undefined);
  assert.equal(r3.ok && r3.data.timezone, "America/New_York");
});
