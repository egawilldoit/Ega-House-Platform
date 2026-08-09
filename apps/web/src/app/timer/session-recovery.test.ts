import assert from "node:assert/strict";
import test from "node:test";

import { resolveSessionConflict } from "./session-recovery";

test("keeps newest open session and closes older sessions", () => {
  const resolution = resolveSessionConflict(
    [
      { id: "old", started_at: "2026-04-14T09:00:00.000Z" },
      { id: "new", started_at: "2026-04-14T10:00:00.000Z" },
    ],
    "2026-04-14T10:30:00.000Z",
  );

  assert.ok(resolution);
  assert.equal(resolution.canonicalSessionId, "new");
  assert.deepEqual(resolution.sessionsToClose, [
    {
      id: "old",
      endedAtIso: "2026-04-14T10:00:00.000Z",
      durationSeconds: 3600,
    },
  ]);
});

test("returns null when there is no conflict", () => {
  assert.equal(resolveSessionConflict([], "2026-04-14T10:30:00.000Z"), null);
  assert.equal(
    resolveSessionConflict(
      [{ id: "single", started_at: "2026-04-14T10:00:00.000Z" }],
      "2026-04-14T10:30:00.000Z",
    ),
    null,
  );
});

test("uses deterministic canonical selection when start times are identical", () => {
  const resolution = resolveSessionConflict(
    [
      { id: "session-a", started_at: "2026-04-14T10:00:00.000Z" },
      { id: "session-b", started_at: "2026-04-14T10:00:00.000Z" },
    ],
    "2026-04-14T10:10:00.000Z",
  );

  assert.ok(resolution);
  assert.equal(resolution.canonicalSessionId, "session-b");
  assert.deepEqual(resolution.sessionsToClose, [
    {
      id: "session-a",
      endedAtIso: "2026-04-14T10:00:00.000Z",
      durationSeconds: 0,
    },
  ]);
});
