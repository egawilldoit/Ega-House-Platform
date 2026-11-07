import { describe, expect, it } from "vitest";

import { DEFAULT_USER_PREFERENCES } from "@ega/domain/preferences";

import {
  SCHEDULE_DRAFT_VERSION,
  clearScheduleDraft,
  createScheduleDraftKey,
  isRestorableSchedule,
  readScheduleDraft,
  scheduleFingerprint,
  writeScheduleDraft,
  type SessionStorageLike,
} from "./schedule-draft-storage";
import type { Schedule } from "./schedule-model";

function schedule(): Schedule {
  return structuredClone(DEFAULT_USER_PREFERENCES.personalOperations);
}

function memoryStorage(): SessionStorageLike & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

describe("schedule draft storage", () => {
  it("builds a stable path + baseline key and changes it with the baseline", () => {
    const baseline = schedule();
    const sameBaselineDifferentOrder = {
      guidance: baseline.guidance,
      targets: baseline.targets,
      paused: baseline.paused,
    } as Schedule;
    const changed = schedule();
    changed.targets.monday.work = 451;

    expect(createScheduleDraftKey("/settings/preferences", baseline)).toBe(
      createScheduleDraftKey("/settings/preferences", sameBaselineDifferentOrder),
    );
    expect(scheduleFingerprint(baseline)).not.toBe(scheduleFingerprint(changed));
    expect(createScheduleDraftKey("/settings/preferences", baseline)).not.toBe(
      createScheduleDraftKey("/settings/preferences", changed),
    );
  });

  it("round-trips an invalid in-progress draft unchanged", () => {
    const storage = memoryStorage();
    const key = createScheduleDraftKey("/settings/preferences", schedule());
    const draft = schedule();
    draft.targets.monday.work = -1;
    draft.guidance[0] = {
      ...draft.guidance[0]!,
      start: "07:00",
      end: "06:00",
    };

    writeScheduleDraft(storage, key, draft, 1234);

    expect(readScheduleDraft(storage, key)).toEqual(draft);
  });

  it("clears the stored draft", () => {
    const storage = memoryStorage();
    const key = createScheduleDraftKey("/settings/preferences", schedule());
    writeScheduleDraft(storage, key, schedule());

    clearScheduleDraft(storage, key);

    expect(storage.entries.has(key)).toBe(false);
    expect(readScheduleDraft(storage, key)).toBeNull();
  });

  it("rejects and removes malformed JSON", () => {
    const storage = memoryStorage();
    const key = createScheduleDraftKey("/settings/preferences", schedule());
    storage.setItem(key, "{not-json");

    expect(readScheduleDraft(storage, key)).toBeNull();
    expect(storage.entries.has(key)).toBe(false);
  });

  it("rejects and removes an unknown version or invalid shape", () => {
    const storage = memoryStorage();
    const key = createScheduleDraftKey("/settings/preferences", schedule());
    storage.setItem(
      key,
      JSON.stringify({ version: SCHEDULE_DRAFT_VERSION + 1, schedule: schedule() }),
    );
    expect(readScheduleDraft(storage, key)).toBeNull();
    expect(storage.entries.has(key)).toBe(false);

    storage.setItem(
      key,
      JSON.stringify({ version: SCHEDULE_DRAFT_VERSION, schedule: { paused: false } }),
    );
    expect(readScheduleDraft(storage, key)).toBeNull();
    expect(storage.entries.has(key)).toBe(false);
  });

  it("does not read a draft stored under another baseline key", () => {
    const storage = memoryStorage();
    const current = schedule();
    const otherBaseline = schedule();
    otherBaseline.targets.monday.work = 451;
    writeScheduleDraft(
      storage,
      createScheduleDraftKey("/settings/preferences", otherBaseline),
      otherBaseline,
    );

    expect(
      readScheduleDraft(
        storage,
        createScheduleDraftKey("/settings/preferences", current),
      ),
    ).toBeNull();
  });

  it("accepts the sentinel and structural draft states the form can produce", () => {
    const draft = schedule();
    draft.targets.monday.jobSearch = -1;

    expect(isRestorableSchedule(draft)).toBe(true);
    expect(isRestorableSchedule({ ...draft, guidance: "nope" })).toBe(false);
  });
});
