import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  getCurrentUser: vi.fn(),
  getWebTimeContext: vi.fn(),
  getWebUserPreferencesState: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/services/auth-service", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isAuthServiceError: (error: unknown) =>
    error instanceof Error && error.name === "AuthServiceError",
}));

vi.mock("@/lib/services/time-context-service", () => ({
  getWebTimeContext: mocks.getWebTimeContext,
}));

vi.mock("@/lib/services/user-preferences-service", () => ({
  getWebUserPreferencesState: mocks.getWebUserPreferencesState,
  updateWebUserPreferences: vi.fn(),
}));

import SettingsPage from "./page";

describe("SettingsPage authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(null);
  });

  it("redirects signed-out requests before launching protected reads", async () => {
    await expect(
      SettingsPage({ searchParams: Promise.resolve({ tab: "preferences" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/login?next=%2Fsettings");

    expect(mocks.redirect).toHaveBeenCalledWith("/login?next=%2Fsettings");
    expect(mocks.getWebTimeContext).not.toHaveBeenCalled();
    expect(mocks.getWebUserPreferencesState).not.toHaveBeenCalled();
  });
});
