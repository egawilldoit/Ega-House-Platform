import { beforeEach, describe, expect, it, vi } from "vitest";

import { DAYS, DEFAULT_PERSONAL_OPERATIONS } from "@ega/domain/preferences";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
}));
vi.mock("@/lib/services/user-preferences-service", () => ({
  getWebUserPreferencesState: vi.fn(),
  updateWebUserPreferences: vi.fn(async () => ({
    preferences: {},
    errorMessage: null,
  })),
}));

import {
  getWebUserPreferencesState,
  updateWebUserPreferences,
} from "@/lib/services/user-preferences-service";
import { updateWorkTargetsAction } from "./work-targets-actions";

const loadState = vi.mocked(getWebUserPreferencesState);
const update = vi.mocked(updateWebUserPreferences);

function formData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const day of DAYS) {
    data.set(`work-${day}`, String(DEFAULT_PERSONAL_OPERATIONS.targets[day].work / 60));
    data.set(
      `jobSearch-${day}`,
      String(DEFAULT_PERSONAL_OPERATIONS.targets[day].jobSearch / 60),
    );
  }
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}

function state(errorMessage: string | null = null) {
  return {
    preferences: {
      personalOperations: DEFAULT_PERSONAL_OPERATIONS,
      jobSearchReference: null,
      categoryCaps: {},
      theme: "system" as const,
      reducedMotion: false,
      launchPage: "home" as const,
      taskLayout: "list" as const,
      taskOpenMode: "panel" as const,
    },
    errorMessage,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadState.mockResolvedValue(state());
});

describe("updateWorkTargetsAction", () => {
  it("writes targets while preserving persisted guidance", async () => {
    await expect(
      updateWorkTargetsAction(formData({ "work-monday": "6", paused: "on" })),
    ).rejects.toThrow("NEXT_REDIRECT:/settings?tab=preferences&success=Work+targets+saved.");

    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0]?.[0] as {
      personalOperations: typeof DEFAULT_PERSONAL_OPERATIONS;
    };
    expect(patch.personalOperations.paused).toBe(true);
    expect(patch.personalOperations.targets.monday).toEqual({ work: 360, jobSearch: 90 });
    expect(patch.personalOperations.guidance).toEqual(DEFAULT_PERSONAL_OPERATIONS.guidance);
  });

  it("rejects invalid hours before writing", async () => {
    await expect(
      updateWorkTargetsAction(formData({ "jobSearch-friday": "30" })),
    ).rejects.toThrow(/tab=preferences&error=/);

    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to overwrite when the current row cannot be read", async () => {
    loadState.mockResolvedValue(state("Unable to load preferences right now."));

    await expect(updateWorkTargetsAction(formData())).rejects.toThrow(
      /Unable\+to\+load\+preferences\+right\+now/,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
