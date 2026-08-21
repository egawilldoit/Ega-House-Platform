import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/mobile/_lib/auth", () => ({
  resolveMobileRequestAuth: vi.fn(),
}));

vi.mock("@/lib/services/timer-service", () => ({
  getActiveTimerSession: vi.fn(),
  getTimerSummary: vi.fn(),
}));

vi.mock("@/lib/monitoring/capture-server-exception", () => ({
  captureServerException: vi.fn(),
}));

import { GET } from "@/app/api/mobile/timer/route";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import {
  getActiveTimerSession,
  getTimerSummary,
} from "@/lib/services/timer-service";

const mockedResolveAuth = vi.mocked(resolveMobileRequestAuth);
const mockedGetActiveTimerSession = vi.mocked(getActiveTimerSession);
const mockedGetTimerSummary = vi.mocked(getTimerSummary);

const SUPABASE = {} as never;

const ACTIVE_SESSION = {
  sessionId: "session-1",
  taskId: "task-1",
  startedAt: "2026-08-21T10:00:00.000Z",
  elapsedLabel: "25m",
  taskTitle: "Write spec",
  taskStatus: "in_progress",
  taskPriority: "high",
  projectName: "Launch",
  projectSlug: "launch",
  goalTitle: null,
};

const SUMMARY = {
  trackedTodaySeconds: 1500,
  trackedTodayLabel: "25m",
  trackedTotalSeconds: 3600,
  trackedTotalLabel: "1h",
  sessionsTodayCount: 1,
  longestSessionSeconds: 1500,
  longestSessionLabel: "25m",
  longestSessionTaskTitle: "Write spec",
};

describe("GET /api/mobile/timer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetActiveTimerSession.mockResolvedValue({
      data: null,
      errorMessage: null,
    });
    mockedGetTimerSummary.mockResolvedValue({
      data: SUMMARY,
      errorMessage: null,
    });
  });

  it("returns 401 without auth", async () => {
    mockedResolveAuth.mockResolvedValue({
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Missing bearer token.",
      status: 401,
    });

    const response = await GET(new Request("http://localhost:3000/api/mobile/timer"));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns the timer workspace state for an authenticated user", async () => {
    mockedResolveAuth.mockResolvedValue({
      ok: true,
      accessToken: "token",
      user: { id: "user-1" } as never,
      supabase: SUPABASE,
    });
    mockedGetActiveTimerSession.mockResolvedValue({
      data: ACTIVE_SESSION,
      errorMessage: null,
    });

    const response = await GET(
      new Request("http://localhost:3000/api/mobile/timer", {
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.timer.activeSession).toEqual(ACTIVE_SESSION);
    expect(body.timer.summary).toEqual(SUMMARY);
    expect(mockedGetActiveTimerSession).toHaveBeenCalledWith({ supabase: SUPABASE });
    expect(mockedGetTimerSummary).toHaveBeenCalledWith({ supabase: SUPABASE });
  });

  it("returns 500 when the active session cannot be loaded", async () => {
    mockedResolveAuth.mockResolvedValue({
      ok: true,
      accessToken: "token",
      user: { id: "user-1" } as never,
      supabase: SUPABASE,
    });
    mockedGetActiveTimerSession.mockResolvedValue({
      data: null,
      errorMessage: "Could not load the active timer right now.",
    });

    const response = await GET(
      new Request("http://localhost:3000/api/mobile/timer", {
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
