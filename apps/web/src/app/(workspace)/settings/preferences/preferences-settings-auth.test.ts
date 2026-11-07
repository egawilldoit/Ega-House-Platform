import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_USER_PREFERENCES } from "@ega/domain/preferences";

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
  getWebUserPreferencesState: vi.fn(),
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

vi.mock("@/lib/services/user-preferences-service", () => ({
  getWebUserPreferencesState: mocks.getWebUserPreferencesState,
}));

vi.mock("./actions", () => ({
  updateWorkspacePreferencesAction: vi.fn(),
  updatePersonalOperationsAction: vi.fn(),
}));

vi.mock("./personal-operations-form", () => ({
  PersonalOperationsForm: () => null,
}));

import WorkspacePreferencesPage from "./page";

const timeContext = {
  timezone: "Africa/Casablanca",
  persistedTimezone: "Africa/Casablanca",
  fallback: "none" as const,
  localDate: "2026-11-07",
};

const loadedState = {
  preferences: DEFAULT_USER_PREFERENCES,
  errorMessage: null,
};

function renderPage(searchParams: Record<string, string> = {}) {
  return WorkspacePreferencesPage({ searchParams: Promise.resolve(searchParams) });
}

/** Flatten the returned React element tree into its visible text. */
function collectText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return collectText(props?.children);
  }
  return "";
}

describe("WorkspacePreferencesPage authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthServiceError.mockImplementation(
      (error: unknown) => error instanceof FakeAuthServiceError,
    );
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.getWebUserPreferencesState.mockResolvedValue(loadedState);
    mocks.getWebTimeContext.mockResolvedValue(timeContext);
  });

  it("redirects signed-out requests to login before launching protected reads", async () => {
    await expect(renderPage()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fsettings%2Fpreferences",
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?next=%2Fsettings%2Fpreferences",
    );
    expect(mocks.getWebUserPreferencesState).not.toHaveBeenCalled();
    expect(mocks.getWebTimeContext).not.toHaveBeenCalled();
  });

  it("redirects when authentication becomes invalid during the time-context read", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.getWebTimeContext.mockRejectedValue(new FakeAuthServiceError());

    await expect(renderPage()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fsettings%2Fpreferences",
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?next=%2Fsettings%2Fpreferences",
    );
  });

  it("keeps unrelated time-context failures non-fatal instead of redirecting", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.getWebTimeContext.mockRejectedValue(
      new Error("time context read failed"),
    );

    const result = await renderPage();

    expect(result).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(collectText(result)).not.toContain("authentication required");
  });

  it("loads preferences for authenticated users", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });

    const result = await renderPage({ success: "Workspace preferences saved." });

    expect(result).toBeTruthy();
    expect(mocks.getWebUserPreferencesState).toHaveBeenCalledTimes(1);
    expect(mocks.getWebTimeContext).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("marks the schedule read-only when the preferences load itself failed", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.getWebUserPreferencesState.mockResolvedValue({
      preferences: DEFAULT_USER_PREFERENCES,
      errorMessage: "Unable to load preferences right now.",
    });

    const text = collectText(await renderPage());

    expect(text).toContain("Unable to load preferences right now.");
    expect(text).toContain("The schedule is read-only until preferences load.");
  });

  it("does not claim the schedule is read-only for a search-param error", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });

    const text = collectText(
      await renderPage({ error: "Unable to save preferences right now." }),
    );

    expect(text).toContain("Unable to save preferences right now.");
    expect(text).not.toContain("The schedule is read-only until preferences load.");
  });
});
