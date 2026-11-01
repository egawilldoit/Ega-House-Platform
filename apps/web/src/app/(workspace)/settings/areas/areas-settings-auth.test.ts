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
  requireAuthenticatedUser: vi.fn(),
  createClient: vi.fn(),
  getProjectsReadModel: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/services/auth-service", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isAuthServiceError: mocks.isAuthServiceError,
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@ega/application", () => ({
  createAuthenticatedActor: (userId: string) => ({ userId }),
  getProjectsReadModel: mocks.getProjectsReadModel,
}));

vi.mock("@ega/data-access", () => ({
  SupabaseProjectsRepository: class {},
}));

vi.mock("./actions", () => ({
  createAreaAction: vi.fn(),
  deleteAreaAction: vi.fn(),
  updateAreaAction: vi.fn(),
}));

import AreasSettingsPage from "./page";

function renderAreasPage() {
  return AreasSettingsPage({ searchParams: Promise.resolve({}) });
}

describe("AreasSettingsPage authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthServiceError.mockImplementation(
      (error: unknown) => error instanceof FakeAuthServiceError,
    );
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.createClient.mockResolvedValue({});
    mocks.requireAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    mocks.getProjectsReadModel.mockResolvedValue({
      ok: true,
      data: { areas: [], projects: [] },
    });
  });

  it("redirects signed-out requests before the protected read runs", async () => {
    await expect(renderAreasPage()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fsettings%2Fareas",
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?next=%2Fsettings%2Fareas",
    );
    expect(mocks.requireAuthenticatedUser).not.toHaveBeenCalled();
    expect(mocks.getProjectsReadModel).not.toHaveBeenCalled();
  });

  it("redirects when the protected read reports an invalid session", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.requireAuthenticatedUser.mockRejectedValue(new FakeAuthServiceError());

    await expect(renderAreasPage()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fsettings%2Fareas",
    );
  });

  it("loads areas for authenticated users", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });

    const result = await renderAreasPage();

    expect(result).toBeTruthy();
    expect(mocks.getProjectsReadModel).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
