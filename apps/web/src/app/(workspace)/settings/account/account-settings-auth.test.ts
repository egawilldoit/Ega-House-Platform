import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeAuthServiceError extends Error {
  readonly code = "UNAUTHENTICATED" as const;

  constructor() {
    super("Authentication required.");
    this.name = "AuthServiceError";
  }
}

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  getCurrentUser: vi.fn(),
  isAuthServiceError: vi.fn(),
  getWebTimeContext: vi.fn(),
  getCalendarIntegrationSettings: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/services/auth-service", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isAuthServiceError: mocks.isAuthServiceError,
}));

vi.mock("@/lib/services/time-context-service", () => ({
  getWebTimeContext: mocks.getWebTimeContext,
}));

vi.mock("@/lib/services/calendar-settings-service", () => ({
  getCalendarIntegrationSettings: mocks.getCalendarIntegrationSettings,
}));

vi.mock("@/app/api/integrations/google-calendar/oauth", () => ({
  getGoogleCalendarOAuthFailureMessage: () => null,
}));

vi.mock("./actions", () => ({
  disconnectGoogleCalendarAction: vi.fn(),
  updateCalendarDefaultsAction: vi.fn(),
}));

import AccountSettingsPage from "./page";

const disconnectedSettings = {
  connected: false,
  googleAccountEmail: null,
  scheduledTaskSyncEnabled: false,
  defaultReminderMinutes: 10,
};

const timeContext = {
  timezone: "UTC",
  persistedTimezone: null,
  fallback: "none" as const,
  localDate: "2026-11-01",
};

function renderAccountPage(searchParams: Record<string, string> = {}) {
  return AccountSettingsPage({ searchParams: Promise.resolve(searchParams) });
}

describe("AccountSettingsPage authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthServiceError.mockImplementation(
      (error: unknown) => error instanceof FakeAuthServiceError,
    );
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.getCalendarIntegrationSettings.mockResolvedValue({
      data: disconnectedSettings,
      errorMessage: null,
    });
    mocks.getWebTimeContext.mockResolvedValue(timeContext);
  });

  it("redirects signed-out requests to login before launching protected reads", async () => {
    await expect(renderAccountPage()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fsettings%2Faccount",
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?next=%2Fsettings%2Faccount",
    );
    expect(mocks.getCalendarIntegrationSettings).not.toHaveBeenCalled();
    expect(mocks.getWebTimeContext).not.toHaveBeenCalled();
  });

  it("redirects when authentication becomes invalid during a protected read", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.getWebTimeContext.mockRejectedValue(new FakeAuthServiceError());

    await expect(renderAccountPage()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fsettings%2Faccount",
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?next=%2Fsettings%2Faccount",
    );
  });

  it("keeps unrelated service failures visible instead of redirecting", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.getWebTimeContext.mockRejectedValue(
      new Error("time context read failed"),
    );

    await expect(renderAccountPage()).rejects.toThrow(
      "time context read failed",
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("loads account settings for authenticated users", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });

    const result = await renderAccountPage({ success: "Saved" });

    expect(result).toBeTruthy();
    expect(mocks.getCalendarIntegrationSettings).toHaveBeenCalledTimes(1);
    expect(mocks.getWebTimeContext).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
