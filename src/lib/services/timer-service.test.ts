import assert from "node:assert/strict";
import test from "node:test";

import { validateTimerSessionTimestampUpdateInput } from "./timer-service";

test("validates and normalizes timer session timestamp updates", () => {
  const result = validateTimerSessionTimestampUpdateInput({
    sessionId: "session-1",
    startedAt: "2026-04-21T09:00:00Z",
    endedAt: "2026-04-21T10:30:00Z",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.sessionId, "session-1");
  assert.equal(result.data?.startedAtIso, "2026-04-21T09:00:00.000Z");
  assert.equal(result.data?.endedAtIso, "2026-04-21T10:30:00.000Z");
  assert.equal(result.data?.durationSeconds, 5400);
});

test("rejects timestamps without explicit timezone", () => {
  const result = validateTimerSessionTimestampUpdateInput({
    sessionId: "session-1",
    startedAt: "2026-04-21T09:00:00",
    endedAt: "2026-04-21T10:30:00Z",
  });

  assert.equal(
    result.errorMessage,
    "Start timestamp must be a valid ISO value with timezone, for example 2026-04-21T10:15:00Z.",
  );
});

test("rejects ended_at values before started_at", () => {
  const result = validateTimerSessionTimestampUpdateInput({
    sessionId: "session-1",
    startedAt: "2026-04-21T11:00:00Z",
    endedAt: "2026-04-21T10:59:59Z",
  });

  assert.equal(result.errorMessage, "End timestamp must be after the start timestamp.");
});

test("requires a session id", () => {
  const result = validateTimerSessionTimestampUpdateInput({
    sessionId: "   ",
    startedAt: "2026-04-21T11:00:00Z",
    endedAt: "2026-04-21T12:00:00Z",
  });

  assert.equal(result.errorMessage, "Session update request is invalid.");
});
