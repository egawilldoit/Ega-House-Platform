import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getCurrentUser: vi.fn(),
  getActiveTimerSession: vi.fn(),
  getTimerWorkspaceData: vi.fn(),
  getWebTimeContext: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/services/auth-service", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/lib/services/timer-service", () => ({
  getActiveTimerSession: mocks.getActiveTimerSession,
  getTimerWorkspaceData: mocks.getTimerWorkspaceData,
}));
vi.mock("@/lib/services/time-context-service", () => ({
  getWebTimeContext: mocks.getWebTimeContext,
}));

import { reconcileTimerSurface } from "./reconcile-action";

describe("reconcileTimerSurface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "owner-1" });
    mocks.getWebTimeContext.mockResolvedValue({
      timezone: "Africa/Casablanca",
      persistedTimezone: "Africa/Casablanca",
      fallback: "account",
      localDate: "2026-11-07",
    });
  });

  it("fails closed without reading timer data or revalidating when unauthenticated", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const result = await reconcileTimerSurface("timer");

    expect(result).toEqual({
      ok: false,
      reason: "unauthenticated",
      message: "Your session expired. Sign in again to sync the timer.",
    });
    expect(mocks.getActiveTimerSession).not.toHaveBeenCalled();
    expect(mocks.getTimerWorkspaceData).not.toHaveBeenCalled();
    expect(mocks.getWebTimeContext).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("treats a thrown auth read as unauthenticated", async () => {
    mocks.getCurrentUser.mockRejectedValue(new Error("Auth unavailable"));

    const result = await reconcileTimerSurface("today");

    expect(result).toMatchObject({ ok: false, reason: "unauthenticated" });
    expect(mocks.getActiveTimerSession).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("confirms the timer surface and revalidates /timer", async () => {
    mocks.getTimerWorkspaceData.mockResolvedValue({
      openSessions: [{ id: "session-1" }],
    });

    const result = await reconcileTimerSurface("timer");

    expect(result).toMatchObject({ ok: true, activeSessionId: "session-1" });
    expect(mocks.getWebTimeContext).toHaveBeenCalledTimes(1);
    expect(mocks.getTimerWorkspaceData).toHaveBeenCalledWith({
      timezone: "Africa/Casablanca",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/timer");
  });

  it("falls back to an unscoped workspace read when the time context fails", async () => {
    mocks.getWebTimeContext.mockRejectedValue(new Error("No time context"));
    mocks.getTimerWorkspaceData.mockResolvedValue({ openSessions: [] });

    const result = await reconcileTimerSurface("timer");

    expect(result).toMatchObject({ ok: true, activeSessionId: null });
    expect(mocks.getTimerWorkspaceData).toHaveBeenCalledWith(undefined);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/timer");
  });

  it("maps only the known today surface, never an arbitrary path", async () => {
    mocks.getActiveTimerSession.mockResolvedValue({ data: null, errorMessage: null });

    const result = await reconcileTimerSurface(
      "/admin" as unknown as "timer",
    );

    expect(result).toMatchObject({ ok: true, activeSessionId: null });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/timer");
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith("/admin");
  });

  it("confirms the today surface and revalidates /today", async () => {
    mocks.getActiveTimerSession.mockResolvedValue({
      data: { sessionId: "session-today" },
      errorMessage: null,
    });

    const result = await reconcileTimerSurface("today");

    expect(result).toMatchObject({ ok: true, activeSessionId: "session-today" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/today");
    expect(mocks.getTimerWorkspaceData).not.toHaveBeenCalled();
  });

  it("returns unavailable without revalidating when the today read reports an error", async () => {
    mocks.getActiveTimerSession.mockResolvedValue({
      data: null,
      errorMessage: "Could not load the active timer right now.",
    });

    const result = await reconcileTimerSurface("today");

    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns unavailable without revalidating when the today read throws", async () => {
    mocks.getActiveTimerSession.mockRejectedValue(new Error("backend down"));

    const result = await reconcileTimerSurface("today");

    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns unavailable without revalidating when the timer workspace throws", async () => {
    mocks.getTimerWorkspaceData.mockRejectedValue(new Error("backend down"));

    const result = await reconcileTimerSurface("timer");

    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
