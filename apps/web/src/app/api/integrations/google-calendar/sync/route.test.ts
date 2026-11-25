import type { CalendarSyncStatusView } from "@ega/application/calendar-sync/service";
import { beforeEach, expect, test, vi } from "vitest";

import {
  continueWebCalendarSync,
  getWebCalendarSyncStatus,
  startWebCalendarSync,
} from "@/lib/services/calendar-sync-engine";

import { GET, POST } from "./route";

vi.mock("@/lib/services/calendar-sync-engine", () => ({
  continueWebCalendarSync: vi.fn(),
  getWebCalendarSyncStatus: vi.fn(),
  startWebCalendarSync: vi.fn(),
}));

const endpoint = "https://ega.example/api/integrations/google-calendar/sync";
const status: CalendarSyncStatusView = {
  connection: {
    connected: false,
    needsReconnect: false,
    accountEmail: null,
    calendarId: "primary",
    destinationKey: "",
  },
  run: null,
  pausedRun: null,
  message: null,
  continuationBlocked: false,
  statusErrors: { connection: null, run: null, pausedRun: null },
};

beforeEach(() => vi.resetAllMocks());

test("GET reports unavailable status without telling the client to reconnect", async () => {
  vi.mocked(getWebCalendarSyncStatus).mockResolvedValue({
    ok: true,
    data: { ...status, statusErrors: { ...status.statusErrors, connection: "Unavailable" } },
  });

  const response = await GET(new Request(endpoint));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    ok: false, error: "Calendar sync status is temporarily unavailable. Retry or reload Tasks.",
  });
});

test.each(["start", "retry", "continue"])("%s reports a failed status read after processing", async (action) => {
  const result = {
    ok: true as const,
    data: { ...status, statusErrors: { ...status.statusErrors, run: "Unavailable" } },
  };
  vi.mocked(startWebCalendarSync).mockResolvedValue(result);
  vi.mocked(continueWebCalendarSync).mockResolvedValue(result);

  const response = await POST(new Request(endpoint, {
    method: "POST",
    body: JSON.stringify({ action, runId: "run-1" }),
  }));
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty("status");
});

test("GET preserves a genuinely empty status", async () => {
  vi.mocked(getWebCalendarSyncStatus).mockResolvedValue({ ok: true, data: status });
  const response = await GET(new Request(endpoint));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, status });
});

test("GET reports a failed run count read as unavailable", async () => {
  vi.mocked(getWebCalendarSyncStatus).mockResolvedValue({
    ok: true,
    data: {
      ...status,
      run: {
        id: "run-1",
        status: "active",
        retryMode: false,
        scanComplete: true,
        counts: null,
        exclusions: [],
        failures: [],
        hasMore: true,
        lastError: null,
        startedAt: "2026-11-24T00:00:00Z",
        completedAt: null,
        statusErrors: { counts: "Unavailable", exclusions: null, failures: null },
      },
    },
  });

  const response = await GET(new Request(endpoint));
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty("status");
});
