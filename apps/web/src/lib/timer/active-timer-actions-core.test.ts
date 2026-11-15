import { describe, expect, it, vi } from "vitest";

import {
  normalizeTimerSessionId,
  readActiveTimerSnapshotWithDependencies,
  stopActiveTimerWithDependencies,
  type ActiveTimerActionDependencies,
} from "./active-timer-actions-core";

function createDependencies(
  overrides: Partial<ActiveTimerActionDependencies> = {},
): ActiveTimerActionDependencies {
  return {
    getCurrentUser: async () => ({ id: "owner-a" }),
    getActiveTimerSession: async () => ({
      data: {
        sessionId: "session-1",
        taskId: "task-1",
        taskTitle: "Focused task",
        projectName: "Project",
        projectSlug: "project",
        startedAt: "2026-11-14T10:00:00.000Z",
      },
      errorMessage: null,
    }),
    stopTimerSession: async () => ({
      errorMessage: null,
      stoppedTaskId: "task-1",
      outcome: "stopped",
    }),
    revalidateTimerSurfaces: vi.fn(),
    nowIso: () => "2026-11-14T10:05:00.000Z",
    ...overrides,
  };
}

describe("readActiveTimerSnapshotWithDependencies", () => {
  it("fails closed before touching timer data when unauthenticated", async () => {
    const getActiveTimerSession = vi.fn();
    const result = await readActiveTimerSnapshotWithDependencies(
      createDependencies({
        getCurrentUser: async () => null,
        getActiveTimerSession,
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "unauthenticated" });
    expect(getActiveTimerSession).not.toHaveBeenCalled();
  });

  it("returns the projected active session after a verified read", async () => {
    const result = await readActiveTimerSnapshotWithDependencies(
      createDependencies(),
    );

    expect(result).toEqual({
      ok: true,
      syncedAt: "2026-11-14T10:05:00.000Z",
      session: {
        sessionId: "session-1",
        taskId: "task-1",
        taskTitle: "Focused task",
        projectName: "Project",
        projectSlug: "project",
        startedAt: "2026-11-14T10:00:00.000Z",
        taskHref: "/tasks/projects/project#task-task-1",
      },
    });
  });

  it("reports unavailable instead of an empty active timer on service failure", async () => {
    const result = await readActiveTimerSnapshotWithDependencies(
      createDependencies({
        getActiveTimerSession: async () => ({
          data: null,
          errorMessage: "read failed",
        }),
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });
});

describe("stopActiveTimerWithDependencies", () => {
  it("never calls the stop service without a verified user", async () => {
    const stopTimerSession = vi.fn();
    const result = await stopActiveTimerWithDependencies(
      "session-1",
      createDependencies({
        getCurrentUser: async () => null,
        stopTimerSession,
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "unauthenticated" });
    expect(stopTimerSession).not.toHaveBeenCalled();
  });

  it("rejects a blank or non-string session id after authentication", async () => {
    const stopTimerSession = vi.fn();

    await expect(
      stopActiveTimerWithDependencies(
        "   ",
        createDependencies({ stopTimerSession }),
      ),
    ).resolves.toMatchObject({ ok: false, reason: "invalid_session" });
    await expect(
      stopActiveTimerWithDependencies(
        { sessionId: "session-1" },
        createDependencies({ stopTimerSession }),
      ),
    ).resolves.toMatchObject({ ok: false, reason: "invalid_session" });
    expect(stopTimerSession).not.toHaveBeenCalled();
  });

  it("forwards the exact session id and revalidates only after success", async () => {
    const stopTimerSession = vi.fn(async () => ({
      errorMessage: null,
      stoppedTaskId: "task-1",
      outcome: "stopped" as const,
    }));
    const revalidateTimerSurfaces = vi.fn();

    const result = await stopActiveTimerWithDependencies(
      "  session-exact  ",
      createDependencies({
        stopTimerSession,
        revalidateTimerSurfaces,
      }),
    );

    expect(stopTimerSession).toHaveBeenCalledWith({
      sessionId: "session-exact",
    });
    expect(revalidateTimerSurfaces).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      outcome: "stopped",
      stoppedTaskId: "task-1",
    });
  });

  it("treats an already-stopped session as an idempotent success", async () => {
    const revalidateTimerSurfaces = vi.fn();
    const result = await stopActiveTimerWithDependencies(
      "session-1",
      createDependencies({
        stopTimerSession: async () => ({
          errorMessage: null,
          stoppedTaskId: "task-1",
          outcome: "already_stopped",
        }),
        revalidateTimerSurfaces,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      outcome: "already_stopped",
    });
    expect(revalidateTimerSurfaces).toHaveBeenCalledTimes(1);
  });

  it("surfaces service errors without claiming success or revalidating", async () => {
    const revalidateTimerSurfaces = vi.fn();
    const result = await stopActiveTimerWithDependencies(
      "session-1",
      createDependencies({
        stopTimerSession: async () => ({
          errorMessage: "No running timer session matches this request.",
          stoppedTaskId: null,
          outcome: null,
        }),
        revalidateTimerSurfaces,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "unavailable",
      message: "No running timer session matches this request.",
    });
    expect(revalidateTimerSurfaces).not.toHaveBeenCalled();
  });
});

describe("normalizeTimerSessionId", () => {
  it("trims valid ids and rejects oversized values", () => {
    expect(normalizeTimerSessionId(" session-1 ")).toBe("session-1");
    expect(normalizeTimerSessionId("x".repeat(201))).toBeNull();
    expect(normalizeTimerSessionId(null)).toBeNull();
  });
});
