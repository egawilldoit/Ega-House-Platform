import { describe, expect, it } from "vitest";

import { DEFAULT_PERSONAL_OPERATIONS } from "@ega/domain";
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "@ega/domain/preferences";

import {
  getWorkTargetProgress,
  type SessionLoader,
  type WorkTargetProgressDependencies,
} from "./work-target-progress-service";

const NOW = new Date("2026-03-04T12:00:00.000Z"); // Wednesday
const TASK_ID = "11111111-1111-4111-8111-111111111111";

function preferencesWith(reference: { kind: "task" | "project"; id: string } | null): UserPreferences {
  return {
    ...DEFAULT_USER_PREFERENCES,
    personalOperations: { ...DEFAULT_PERSONAL_OPERATIONS, jobSearchReference: reference },
  };
}

function dependencies(overrides: Partial<WorkTargetProgressDependencies> = {}): WorkTargetProgressDependencies {
  return {
    getCurrentUser: async () => ({ id: "owner-1" }),
    getTimezone: async () => "UTC",
    getPreferences: async () => preferencesWith({ kind: "task", id: TASK_ID }),
    loadSessions: async () => ({ data: [], errorMessage: null }),
    ...overrides,
  };
}

describe("getWorkTargetProgress", () => {
  it("passes the verified owner id to the bounded week query", async () => {
    let captured: Parameters<SessionLoader>[0] | null = null;
    const loadSessions: SessionLoader = async (args) => {
      captured = args;
      return { data: [], errorMessage: null };
    };

    const result = await getWorkTargetProgress({
      now: NOW,
      dependencies: dependencies({ loadSessions }),
    });

    expect(result.errorMessage).toBeNull();
    expect(captured).not.toBeNull();
    expect(captured!.ownerUserId).toBe("owner-1");
  });

  it("requests one bounded current-week window, not a recent-N list", async () => {
    let captured: Parameters<SessionLoader>[0] | null = null;
    const loadSessions: SessionLoader = async (args) => {
      captured = args;
      return { data: [], errorMessage: null };
    };

    await getWorkTargetProgress({
      now: NOW,
      dependencies: dependencies({ loadSessions }),
    });

    expect(captured!.window.startIso).toBe("2026-03-02T00:00:00.000Z");
    expect(captured!.window.endIso).toBe("2026-03-04T12:00:00.000Z");
  });

  it("surfaces an unconfigured job-search reference without inventing completion", async () => {
    const result = await getWorkTargetProgress({
      now: NOW,
      dependencies: dependencies({
        getPreferences: async () => preferencesWith(null),
      }),
    });

    expect(result.errorMessage).toBeNull();
    expect(result.data?.jobSearchConfigured).toBe(false);
    expect(result.data?.reference).toBeNull();
    expect(result.data?.week.actualJobSearchMinutes).toBe(0);
  });

  it("returns a failure, not a success-shaped report, when the session read fails", async () => {
    const result = await getWorkTargetProgress({
      now: NOW,
      dependencies: dependencies({
        loadSessions: async () => ({
          data: null,
          errorMessage: "Failed to load work analytics sessions: boom",
        }),
      }),
    });

    expect(result.data).toBeNull();
    expect(result.errorMessage).toBe("Failed to load work analytics sessions: boom");
  });

  it("returns a failure when preferences cannot be read", async () => {
    const result = await getWorkTargetProgress({
      now: NOW,
      dependencies: dependencies({
        getPreferences: async () => {
          throw new Error("preferences down");
        },
      }),
    });

    expect(result.data).toBeNull();
    expect(result.errorMessage).toMatch(/personal targets/i);
  });

  it("returns a failure for an unauthenticated caller", async () => {
    const result = await getWorkTargetProgress({
      now: NOW,
      dependencies: dependencies({ getCurrentUser: async () => null }),
    });

    expect(result.data).toBeNull();
    expect(result.errorMessage).toMatch(/log in/i);
  });
});
