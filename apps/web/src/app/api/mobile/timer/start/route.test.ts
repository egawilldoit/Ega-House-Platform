import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/mobile/_lib/auth", () => ({
  resolveMobileRequestAuth: vi.fn(),
}));

vi.mock("@/lib/services/timer-service", () => ({
  startTimerForTask: vi.fn(),
  getActiveTimerSession: vi.fn(),
  getTimerSummary: vi.fn(),
}));

vi.mock("@/lib/monitoring/capture-server-exception", () => ({
  captureServerException: vi.fn(),
}));

import { POST } from "@/app/api/mobile/timer/start/route";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import {
  getActiveTimerSession,
  getTimerSummary,
  startTimerForTask,
} from "@/lib/services/timer-service";

const mockedResolveAuth = vi.mocked(resolveMobileRequestAuth);
const mockedStartTimerForTask = vi.mocked(startTimerForTask);
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

function postStart(body: unknown) {
  return POST(
    new Request("http://localhost:3000/api/mobile/timer/start", {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/mobile/timer/start", () => {
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

    const response = await postStart({ taskId: "task-1" });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 400 when taskId is missing", async () => {
    mockAuthenticated();

    const response = await postStart({});

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when the service rejects the start", async () => {
    mockAuthenticated();
    mockedStartTimerForTask.mockResolvedValue({
      errorMessage: "A timer is already running. Stop it first.",
    });

    const response = await postStart({ taskId: "task-1" });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.message).toBe("A timer is already running. Stop it first.");
    expect(mockedStartTimerForTask).toHaveBeenCalledWith("task-1", { supabase: SUPABASE });
  });

  it("returns 201 with the refreshed timer workspace state", async () => {
    mockAuthenticated();
    mockedStartTimerForTask.mockResolvedValue({ errorMessage: null });

    const response = await postStart({ taskId: "task-1" });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.timer.activeSession).toBeNull();
    expect(body.timer.summary).toEqual(SUMMARY);
  });
});
