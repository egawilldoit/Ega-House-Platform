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
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/services/auth-service", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isAuthServiceError: mocks.isAuthServiceError,
}));

import {
  redirectToSettingsLogin,
  rethrowSettingsLoadError,
  requireSettingsPageUser,
} from "./settings-auth-guard";

describe("settings auth guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthServiceError.mockImplementation(
      (error: unknown) => error instanceof FakeAuthServiceError,
    );
  });

  it("redirects signed-out requests to login with the settings path", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(requireSettingsPageUser("/settings/account")).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fsettings%2Faccount",
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?next=%2Fsettings%2Faccount",
    );
  });

  it("returns the verified user when a session exists", async () => {
    const user = { id: "user-1", email: "owner@example.com" };
    mocks.getCurrentUser.mockResolvedValue(user);

    await expect(requireSettingsPageUser("/settings/areas")).resolves.toBe(user);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("turns an unauthenticated service failure into the login redirect", () => {
    expect(() =>
      rethrowSettingsLoadError(new FakeAuthServiceError(), "/settings/account"),
    ).toThrow("NEXT_REDIRECT:/login?next=%2Fsettings%2Faccount");
  });

  it("re-throws unrelated service failures unchanged", () => {
    const failure = new Error("time context store unavailable");

    expect(() =>
      rethrowSettingsLoadError(failure, "/settings/account"),
    ).toThrow(failure);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("re-throws Next.js redirect control flow instead of converting it", () => {
    const redirectError = new Error("NEXT_REDIRECT:/dashboard");

    expect(() =>
      rethrowSettingsLoadError(redirectError, "/settings/account"),
    ).toThrow(redirectError);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("encodes a nested settings path in the return destination", () => {
    expect(() => redirectToSettingsLogin("/settings/account")).toThrow(
      "NEXT_REDIRECT:/login?next=%2Fsettings%2Faccount",
    );
  });
});
