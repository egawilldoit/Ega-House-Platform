import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWebTimeContext: vi.fn(),
  getCurrentUser: vi.fn(),
  getShutdownData: vi.fn(),
}));

vi.mock("@/lib/services/time-context-service", () => ({
  getWebTimeContext: mocks.getWebTimeContext,
}));
vi.mock("@/lib/services/auth-service", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/lib/services/shutdown-service", () => ({
  getShutdownData: mocks.getShutdownData,
}));

import { getShutdownPageModel } from "./shutdown-page-model";

describe("getShutdownPageModel", () => {
  it("forwards the owner's local date, timezone and verified id to Shutdown", async () => {
    mocks.getWebTimeContext.mockResolvedValue({
      timezone: "Pacific/Honolulu",
      persistedTimezone: "Pacific/Honolulu",
      fallback: "none",
      localDate: "2026-08-10",
    });
    mocks.getCurrentUser.mockResolvedValue({ id: "owner-a" });
    mocks.getShutdownData.mockResolvedValue({ errorMessage: null, data: null });

    await getShutdownPageModel({});

    expect(mocks.getShutdownData).toHaveBeenCalledWith({
      localDate: "2026-08-10",
      timezone: "Pacific/Honolulu",
      ownerUserId: "owner-a",
    });
  });

  it("degrades explicitly when Time Context or identity is unavailable", async () => {
    mocks.getWebTimeContext.mockRejectedValue(new Error("time context down"));
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.getShutdownData.mockResolvedValue({ errorMessage: null, data: null });

    await getShutdownPageModel({});

    expect(mocks.getShutdownData).toHaveBeenCalledWith({
      localDate: undefined,
      timezone: undefined,
      ownerUserId: undefined,
    });
  });
});
