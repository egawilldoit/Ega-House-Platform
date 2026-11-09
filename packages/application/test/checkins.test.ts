import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "../src/auth/actor";
import { createDailyCheckinService } from "../src/checkins/service";
import type { DailyCheckinRepository } from "../src/checkins/ports";
import type { RepositoryResult } from "../src/shared/result";
import type { DailyCheckin } from "@ega/domain/checkins";

const ACTOR = createAuthenticatedActor("owner-checkins");

function seed(record: Partial<DailyCheckin>): DailyCheckin {
  return {
    localDate: "2026-02-16",
    timezone: "Africa/Casablanca",
    outcomes: null,
    personalMinutes: null,
    notes: null,
    overtimeMinutes: null,
    overtimeReason: null,
    routine: null,
    createdAt: "2026-02-16T20:00:00.000Z",
    updatedAt: "2026-02-16T20:00:00.000Z",
    ...record,
  };
}

class FakeRepository implements DailyCheckinRepository {
  rows = new Map<string, DailyCheckin>();
  failNext = false;

  async get(_actor: unknown, localDate: string): Promise<RepositoryResult<DailyCheckin | null>> {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, error: { code: "unknown" } };
    }
    return { ok: true, value: this.rows.get(localDate) ?? null };
  }

  async listBetween(
    _actor: unknown,
    startLocalDate: string,
    endLocalDate: string,
  ): Promise<RepositoryResult<DailyCheckin[]>> {
    return {
      ok: true,
      value: [...this.rows.values()]
        .filter((row) => row.localDate >= startLocalDate && row.localDate <= endLocalDate)
        .sort((a, b) => a.localDate.localeCompare(b.localDate)),
    };
  }

  async save(_actor: unknown, record: DailyCheckin): Promise<RepositoryResult<DailyCheckin>> {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, error: { code: "unknown" } };
    }
    this.rows.set(record.localDate, record);
    return { ok: true, value: record };
  }
}

const INPUT = (patch: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
  localDate: "2026-02-16",
  timezone: "Africa/Casablanca",
  patch: patch as never,
  ...overrides,
});

test("save creates one record and retries upsert the same owner/date", async () => {
  const repo = new FakeRepository();
  const service = createDailyCheckinService(repo);

  const first = await service.saveDailyCheckin(ACTOR, INPUT({ outcomes: "Did things", personalMinutes: 20 }));
  assert.equal(first.ok, true);
  const second = await service.saveDailyCheckin(ACTOR, INPUT({ notes: "Follow-up" }));
  assert.equal(second.ok, true);

  assert.equal(repo.rows.size, 1);
  const stored = repo.rows.get("2026-02-16");
  assert.equal(stored?.outcomes, "Did things");
  assert.equal(stored?.personalMinutes, 20);
  assert.equal(stored?.notes, "Follow-up");
});

test("concurrent partial edits preserve each other's fields", async () => {
  const repo = new FakeRepository();
  repo.rows.set("2026-02-16", seed({ outcomes: "A", notes: "B", personalMinutes: 10 }));
  const service = createDailyCheckinService(repo);

  const result = await service.saveDailyCheckin(ACTOR, INPUT({ notes: "B-prime" }));
  assert.equal(result.ok, true);
  const stored = repo.rows.get("2026-02-16");
  assert.equal(stored?.outcomes, "A");
  assert.equal(stored?.personalMinutes, 10);
  assert.equal(stored?.notes, "B-prime");
});

test("overtime minutes without a reason are rejected and nothing persists", async () => {
  const repo = new FakeRepository();
  const service = createDailyCheckinService(repo);

  const result = await service.saveDailyCheckin(ACTOR, INPUT({ overtimeMinutes: 45 }));
  assert.equal(result.ok, false);
  assert.equal(repo.rows.size, 0);
});

test("third weekly overtime evening saves with an advisory, not a block", async () => {
  const repo = new FakeRepository();
  const service = createDailyCheckinService(repo);
  // Mon 2026-02-16 week: seed two earlier overtime evenings.
  repo.rows.set("2026-02-17", seed({ localDate: "2026-02-17", overtimeMinutes: 20, overtimeReason: "r" }));
  repo.rows.set("2026-02-18", seed({ localDate: "2026-02-18", overtimeMinutes: 20, overtimeReason: "r" }));

  const result = await service.saveDailyCheckin(
    ACTOR,
    INPUT({ overtimeMinutes: 30, overtimeReason: "Launch" }, { localDate: "2026-02-19" }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.data.overtimeAdvisory?.includes("3 overtime evenings"));
});

test("two weekly overtime evenings produce no advisory", async () => {
  const repo = new FakeRepository();
  const service = createDailyCheckinService(repo);
  repo.rows.set("2026-02-17", seed({ localDate: "2026-02-17", overtimeMinutes: 20, overtimeReason: "r" }));

  const result = await service.saveDailyCheckin(
    ACTOR,
    INPUT({ overtimeMinutes: 30, overtimeReason: "Launch" }, { localDate: "2026-02-19" }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.overtimeAdvisory, null);
});

test("repository failure is surfaced, never success-shaped", async () => {
  const repo = new FakeRepository();
  repo.failNext = true;
  const service = createDailyCheckinService(repo);

  const result = await service.saveDailyCheckin(ACTOR, INPUT({ outcomes: "x" }));
  assert.equal(result.ok, false);
});

test("backdated records save under their own local date", async () => {
  const repo = new FakeRepository();
  const service = createDailyCheckinService(repo);

  const result = await service.saveDailyCheckin(
    ACTOR,
    INPUT({ outcomes: "Late entry" }, { localDate: "2026-02-10" }),
  );
  assert.equal(result.ok, true);
  assert.ok(repo.rows.has("2026-02-10"));
});

test("invalid identity and empty patch are rejected", async () => {
  const service = createDailyCheckinService(new FakeRepository());
  assert.equal(
    (await service.saveDailyCheckin(ACTOR, INPUT({ outcomes: "x" }, { localDate: "not-a-date" }))).ok,
    false,
  );
  assert.equal(
    (await service.saveDailyCheckin(ACTOR, INPUT({ outcomes: "x" }, { timezone: "Not/AZone" }))).ok,
    false,
  );
  assert.equal((await service.saveDailyCheckin(ACTOR, INPUT({}))).ok, false);
});
