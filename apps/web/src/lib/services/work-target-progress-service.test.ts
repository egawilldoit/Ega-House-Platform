import { describe, expect, it } from "vitest";

import { DEFAULT_PERSONAL_OPERATIONS } from "@ega/domain";
import { DEFAULT_USER_PREFERENCES, type JobSearchReference, type UserPreferences } from "@ega/domain/preferences";

import {
  getWorkTargetProgress,
  type SessionLoader,
  type WorkTargetProgressDependencies,
} from "./work-target-progress-service";

const NOW = new Date("2026-03-04T12:00:00.000Z"); // Wednesday
const TASK_ID = "11111111-1111-4111-8111-111111111111";

function preferencesWith(
  reference: JobSearchReference | null,
  personalOperations = DEFAULT_PERSONAL_OPERATIONS,
): UserPreferences {
  return { ...DEFAULT_USER_PREFERENCES, personalOperations, jobSearchReference: reference };
}

function dependencies(overrides: Partial<WorkTargetProgressDependencies> = {}): WorkTargetProgressDependencies {
  return {
    getCurrentUser: async () => ({ id: "owner-1" }),
    getTimezone: async () => "UTC",
    getPreferencesState: async () => ({
      preferences: preferencesWith({ kind: "task", id: TASK_ID }),
      errorMessage: null,
    }),
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

    await getWorkTargetProgress({ now: NOW, dependencies: dependencies({ loadSessions }) });

    expect(captured!.window.startIso).toBe("2026-03-02T00:00:00.000Z");
    expect(captured!.window.endIso).toBe("2026-03-04T12:00:00.000Z");
  });

  it("forwards a non-UTC timezone into the bounded local-week query", async () => {
    let captured: Parameters<SessionLoader>[0] | null = null;
    const loadSessions: SessionLoader = async (args) => {
      captured = args;
      return { data: [], errorMessage: null };
    };

    const result = await getWorkTargetProgress({
      now: NOW,
      dependencies: dependencies({ getTimezone: async () => "America/New_York", loadSessions }),
    });

    expect(captured!.window.startIso).toBe("2026-03-02T05:00:00.000Z");
    expect(result.data?.timezone).toBe("America/New_York");
    expect(result.data?.weekStart).toBe("2026-03-02");
  });

  it("forwards includeOpenSessions and surfaces provisional quality", async () => {
    const result = await getWorkTargetProgress({
      now: new Date("2026-03-02T10:00:00.000Z"),
      includeOpenSessions: true,
      dependencies: dependencies({
        loadSessions: async () => ({
          data: [{
            task_id: TASK_ID,
            started_at: "2026-03-02T09:00:00.000Z",
            ended_at: null,
            duration_seconds: null,
            tasks: { id: TASK_ID, title: "Job search" },
          }],
          errorMessage: null,
        }),
      }),
    });

    expect(result.errorMessage).toBeNull();
    expect(result.data?.includeOpenSessions).toBe(true);
    expect(result.data?.quality).toBe("provisional");
    expect(result.data?.today.actualWorkMinutes).toBe(60);
  });

  it("propagates custom targets and a custom reference", async () => {
    const personalOperations = {
      ...DEFAULT_PERSONAL_OPERATIONS,
      targets: {
        ...DEFAULT_PERSONAL_OPERATIONS.targets,
        monday: { work: 600, jobSearch: 30 },
      },
    };
    const result = await getWorkTargetProgress({
      now: new Date("2026-03-02T12:00:00.000Z"),
      dependencies: dependencies({
        getPreferencesState: async () => ({
          preferences: preferencesWith({ kind: "task", id: TASK_ID }, personalOperations),
          errorMessage: null,
        }),
      }),
    });

    expect(result.data?.today.targetWorkMinutes).toBe(600);
    expect(result.data?.today.targetJobSearchMinutes).toBe(30);
    expect(result.data?.reference).toEqual({ kind: "task", id: TASK_ID });
  });

  it("surfaces an unconfigured job-search reference without inventing completion", async () => {
    const result = await getWorkTargetProgress({
      now: NOW,
      dependencies: dependencies({
        getPreferencesState: async () => ({
          preferences: preferencesWith(null),
          errorMessage: null,
        }),
      }),
    });

    expect(result.errorMessage).toBeNull();
    expect(result.data?.jobSearchConfigured).toBe(false);
    expect(result.data?.reference).toBeNull();
    expect(result.data?.week.actualJobSearchMinutes).toBe(0);
  });

  it("returns a failure when the preferences read reports an error, even with defaults", async () => {
    const result = await getWorkTargetProgress({
      now: NOW,
      dependencies: dependencies({
        getPreferencesState: async () => ({
          preferences: DEFAULT_USER_PREFERENCES,
          errorMessage: "preferences down",
        }),
      }),
    });

    expect(result.data).toBeNull();
    expect(result.errorMessage).toMatch(/personal targets/i);
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

  it("returns a failure for an unauthenticated caller", async () => {
    const result = await getWorkTargetProgress({
      now: NOW,
      dependencies: dependencies({ getCurrentUser: async () => null }),
    });

    expect(result.data).toBeNull();
    expect(result.errorMessage).toMatch(/log in/i);
  });
});
