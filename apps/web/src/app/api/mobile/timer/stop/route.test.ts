import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/mobile/_lib/auth", () => ({
  resolveMobileRequestAuth: vi.fn(),
}));

vi.mock("@/lib/services/timer-service", () => ({
  stopTimerSession: vi.fn(),
  getActiveTimerSession: vi.fn(),
  getTimerSummary: vi.fn(),
}));

vi.mock("@/lib/monitoring/capture-server-exception", () => ({
  captureServerException: vi.fn(),
}));

import { POST } from "@/app/api/mobile/timer/stop/route";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import {
  getActiveTimerSession,
  getTimerSummary,
  stopTimerSession,
} from "@/lib/services/timer-service";

const mockedResolveAuth = vi.mocked(resolveMobileRequestAuth);
const mockedStopTimerSession = vi.mocked(stopTimerSession);
const mockedGetActiveTimerSession = vi.mocked(getActiveTimerSession);
const mockedGetTimerSummary = vi.mocked(getTimerSummary);

const SUPABASE = {} as never;

const SUMMARY = {
  trackedTodaySeconds: 0,
  trackedTodayLabel: "0m",
  trackedTotalSeconds: 0,
  trackedTotalLabel: "0m",
  sessionsTodayCount: 0,
  longestSessionSeconds: null,
  longestSessionLabel: null,
  longestSessionTaskTitle: null,
};

function mockAuthenticated() {
  mockedResolveAuth.mockResolvedValue({
    ok: true,
    accessToken: "token",
    user: { id: "user-1" } as never,
    supabase: SUPABASE,
  });
  mockedGetActiveTimerSession.mockResolvedValue({ data: null, errorMessage: null });
  mockedGetTimerSummary.mockResolvedValue({ data: SUMMARY, errorMessage: null });
}

function postStop(body?: unknown) {
  return POST(
    new Request("http://localhost:3000/api/mobile/timer/stop", {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

describe("POST /api/mobile/timer/stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    mockedResolveAuth.mockResolvedValue({
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Missing bearer token.",
      status: 401,
    });

    const response = await postStop({});

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 400 when the service rejects the stop", async () => {
    mockAuthenticated();
    mockedStopTimerSession.mockResolvedValue({
      errorMessage: "No active timer session is available to stop.",
      stoppedTaskId: null,
    });

    const response = await postStop({ sessionId: "session-1" });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.message).toBe("No active timer session is available to stop.");
    expect(mockedStopTimerSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      supabase: SUPABASE,
    });
  });

  it("returns 200 with the stopped task id and refreshed state", async () => {
    mockAuthenticated();
    mockedStopTimerSession.mockResolvedValue({
      errorMessage: null,
      stoppedTaskId: "task-1",
    });

    const response = await postStop({ sessionId: "session-1" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.stoppedTaskId).toBe("task-1");
    expect(body.timer.summary).toEqual(SUMMARY);
  });
});
