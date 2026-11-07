import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_USER_PREFERENCES, type UserPreferences, type UserPreferencesPatch } from "@ega/domain/preferences";

import { createAuthenticatedActor } from "../src/auth/actor";
import {
  getUserPreferences,
  updateUserPreferences,
  type UserPreferencesRepository,
} from "../src/preferences/user-preferences";
import type { RepositoryResult } from "../src/shared/result";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

class FakeUserPreferencesRepository implements UserPreferencesRepository {
  stored: UserPreferences | null;
  reads = 0;
  writes: Array<{ userId: string; preferences: UserPreferences }> = [];

  constructor(
    initial: UserPreferences | null = null,
    private readonly failRead = false,
    private readonly failWrite = false,
  ) {
    this.stored = initial;
  }

  async get(): Promise<RepositoryResult<UserPreferences | null>> {
    this.reads += 1;
    if (this.failRead) return { ok: false, error: { code: "unknown" } };
    return ok(this.stored);
  }

  async patch(
    actor: { userId: string },
    patch: UserPreferencesPatch,
  ): Promise<RepositoryResult<UserPreferences>> {
    if (this.failWrite) return { ok: false, error: { code: "unknown" } };
    const preferences = { ...(this.stored ?? DEFAULT_USER_PREFERENCES), ...patch };
    this.stored = preferences;
    this.writes.push({ userId: actor.userId, preferences });
    return ok(preferences);
  }
}

const ACTOR = createAuthenticatedActor("owner-a");

test("an owner without a row reads the documented defaults", async () => {
  const repository = new FakeUserPreferencesRepository(null);
  const result = await getUserPreferences(ACTOR, repository);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data, DEFAULT_USER_PREFERENCES);
  assert.equal(repository.writes.length, 0);
});

test("a persisted row is normalized before use", async () => {
  const repository = new FakeUserPreferencesRepository({
    ...DEFAULT_USER_PREFERENCES,
    theme: "dark",
    density: "compact",
  });
  const result = await getUserPreferences(ACTOR, repository);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.theme, "dark");
  assert.equal(result.data.density, "compact");
  assert.equal(result.data.accent, "neutral");
});

test("a patch merges over the current row and persists under the verified owner", async () => {
  const repository = new FakeUserPreferencesRepository(null);
  const result = await updateUserPreferences(ACTOR, repository, {
    theme: "dark",
    accent: "violet",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.theme, "dark");
  assert.equal(result.data.accent, "violet");
  // Untouched fields keep the previous/default value.
  assert.equal(result.data.launchPage, "home");
  assert.equal(result.data.taskOpenMode, "panel");
  assert.equal(repository.writes.length, 1);
  assert.equal(repository.writes[0]?.userId, "owner-a");
  assert.equal(repository.writes[0]?.preferences.theme, "dark");
});

test("an invalid enum is rejected before any read or write", async () => {
  const repository = new FakeUserPreferencesRepository(null);
  const result = await updateUserPreferences(ACTOR, repository, {
    theme: "sepia",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "validation");
  assert.match(result.errorMessage, /Light, Dark or System/);
  assert.equal(repository.reads, 0);
  assert.equal(repository.writes.length, 0);
});

test("a caller-supplied owner id is ignored", async () => {
  const repository = new FakeUserPreferencesRepository(null);
  await updateUserPreferences(ACTOR, repository, {
    theme: "light",
    userId: "owner-b",
    ownerUserId: "owner-b",
  });

  assert.equal(repository.writes[0]?.userId, "owner-a");
});

test("read and write failures surface an actionable message, never success", async () => {
  const readFailure = await getUserPreferences(
    ACTOR,
    new FakeUserPreferencesRepository(null, true),
  );
  assert.equal(readFailure.ok, false);
  if (!readFailure.ok) assert.match(readFailure.errorMessage, /load preferences/i);

  const writeFailure = await updateUserPreferences(
    ACTOR,
    new FakeUserPreferencesRepository(null, false, true),
    { theme: "dark" },
  );
  assert.equal(writeFailure.ok, false);
  if (!writeFailure.ok) assert.match(writeFailure.errorMessage, /save preferences/i);
});

test("an empty patch leaves the stored row unchanged and never writes", async () => {
  const repository = new FakeUserPreferencesRepository(null);
  const result = await updateUserPreferences(ACTOR, repository, {});

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data, DEFAULT_USER_PREFERENCES);
  assert.equal(repository.reads, 1);
  assert.equal(repository.writes.length, 0);
});

test("one invalid field rejects the whole patch and writes nothing", async () => {
  const repository = new FakeUserPreferencesRepository(null);
  const result = await updateUserPreferences(ACTOR, repository, {
    theme: "dark",
    accent: "violet",
    density: "tiny",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "validation");
  assert.equal(repository.reads, 0);
  assert.equal(repository.writes.length, 0);
});

test("a theme patch sends no schedule and a schedule patch sends no appearance", async () => {
  const sent: UserPreferencesPatch[] = [];
  const repository: UserPreferencesRepository = {
    get: async () => ok({ ...DEFAULT_USER_PREFERENCES }),
    patch: async (_actor, patch) => {
      sent.push(patch);
      return ok({ ...DEFAULT_USER_PREFERENCES, ...patch });
    },
  };

  await updateUserPreferences(ACTOR, repository, { theme: "dark" });
  assert.deepEqual(sent[0], { theme: "dark" });
  assert.equal("personalOperations" in (sent[0] ?? {}), false);

  const schedule = { ...DEFAULT_USER_PREFERENCES.personalOperations, paused: true };
  await updateUserPreferences(ACTOR, repository, { personalOperations: schedule });
  assert.deepEqual(sent[1], { personalOperations: schedule });
  for (const field of [
    "theme",
    "accent",
    "density",
    "reducedMotion",
    "launchPage",
    "taskLayout",
    "taskOpenMode",
  ]) {
    assert.equal(field in (sent[1] ?? {}), false, `${field} must not be sent by a schedule patch`);
  }
});


test("concurrent independent patches preserve both updates", async () => {
  const repository = new FakeUserPreferencesRepository();
  const schedule = { ...DEFAULT_USER_PREFERENCES.personalOperations, paused: true };
  await Promise.all([
    updateUserPreferences(ACTOR, repository, { theme: "dark" }),
    updateUserPreferences(ACTOR, repository, { personalOperations: schedule }),
  ]);
  assert.equal(repository.stored?.theme, "dark");
  assert.equal(repository.stored?.personalOperations.paused, true);
});
