import { describe, expect, it } from "vitest";

import {
  toActiveTimerSnapshot,
  type ActiveTimerSessionLike,
} from "./active-timer-contract";

const session: ActiveTimerSessionLike = {
  sessionId: "session-1",
  taskId: "task-42",
  taskTitle: "Ship the focus timer",
  projectName: "EGA House",
  projectSlug: "ega-house",
  startedAt: "2026-11-14T10:00:00.000Z",
};

describe("toActiveTimerSnapshot", () => {
  it("keeps the persisted start instant and builds a task deep link", () => {
    expect(toActiveTimerSnapshot(session)).toEqual({
      sessionId: "session-1",
      taskId: "task-42",
      taskTitle: "Ship the focus timer",
      projectName: "EGA House",
      projectSlug: "ega-house",
      startedAt: "2026-11-14T10:00:00.000Z",
      taskHref: "/tasks/projects/ega-house#task-task-42",
    });
  });

  it("falls back to the generic tasks surface without a project slug", () => {
    expect(
      toActiveTimerSnapshot({ ...session, projectSlug: null })?.taskHref,
    ).toBe("/tasks");
  });

  it("returns null for no active session", () => {
    expect(toActiveTimerSnapshot(null)).toBeNull();
  });
});
