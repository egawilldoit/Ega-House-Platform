import assert from "node:assert/strict";
import test from "node:test";
import { beforeEach, vi } from "vitest";

vi.mock("@/lib/services/checkin-service", () => ({
  saveWebDailyCheckin: vi.fn(),
}));
vi.mock("@/lib/services/shutdown-service", () => ({
  saveShutdownReflectionNote: vi.fn(),
}));
vi.mock("@/lib/services/time-context-service", () => ({
  getWebTimeContext: vi.fn(),
}));
vi.mock("@/lib/workspace/workspace-navigation", () => ({
  redirectWithWorkspaceFeedback: vi.fn(),
  revalidateWorkspaceFor: vi.fn(),
}));

import { saveWebDailyCheckin } from "@/lib/services/checkin-service";
import { saveShutdownReflectionNote } from "@/lib/services/shutdown-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import {
  redirectWithWorkspaceFeedback,
  revalidateWorkspaceFor,
} from "@/lib/workspace/workspace-navigation";

import { saveTodayCheckinAction, saveTodayReflectionNoteAction } from "./checkin-actions";

const REDIRECT_SENTINEL = new Error("redirect");

function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function run(action: (form: FormData) => Promise<void>, form: FormData) {
  try {
    await action(form);
  } catch (error) {
    if (error !== REDIRECT_SENTINEL) throw error;
  }
}

function lastRedirect(): [string, Record<string, unknown> | undefined] {
  const calls = vi.mocked(redirectWithWorkspaceFeedback).mock.calls;
  assert.ok(calls.length > 0, "expected a redirect");
  return calls[calls.length - 1] as [string, Record<string, unknown> | undefined];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWebTimeContext).mockResolvedValue({
    localDate: "2026-11-07",
    timezone: "Africa/Lagos",
  } as never);
  vi.mocked(saveWebDailyCheckin).mockResolvedValue({
    checkin: null,
    overtimeAdvisory: null,
    errorMessage: null,
  } as never);
  vi.mocked(saveShutdownReflectionNote).mockResolvedValue({
    errorMessage: null,
  } as never);
  vi.mocked(redirectWithWorkspaceFeedback).mockImplementation(() => {
    throw REDIRECT_SENTINEL;
  });
  vi.mocked(revalidateWorkspaceFor).mockImplementation(() => {});
});

test("Finish day saves against the canonical Time Context timezone", async () => {
  await run(
    saveTodayCheckinAction,
    formData({
      returnTo: "/today?finishDay=1",
      localDate: "",
      outcomes: "Shipped the reduction",
      "routine.runMinutes": "20",
    }),
  );

  assert.deepEqual(vi.mocked(saveWebDailyCheckin).mock.calls[0], [
    {
      localDate: "2026-11-07",
      timezone: "Africa/Lagos",
      patch: {
        outcomes: "Shipped the reduction",
        personalMinutes: null,
        notes: "",
        overtimeMinutes: null,
        overtimeReason: "",
        routine: { runMinutes: 20 },
      },
    },
  ]);
  assert.deepEqual(vi.mocked(revalidateWorkspaceFor).mock.calls[0], [
    "shutdown",
    { returnTo: "/today?finishDay=1" },
  ]);
  const [target, feedback] = lastRedirect();
  assert.equal(target, "/today?finishDay=1");
  assert.deepEqual(feedback, { successMessage: "Check-in saved for your day." });
});

test("Finish day rejects fractional minutes without writing", async () => {
  await run(
    saveTodayCheckinAction,
    formData({ returnTo: "/today?finishDay=1", personalMinutes: "2.5" }),
  );

  assert.equal(vi.mocked(saveWebDailyCheckin).mock.calls.length, 0);
  const [, feedback] = lastRedirect();
  assert.deepEqual(feedback, {
    errorMessage: "Use whole minutes for personal time and overtime.",
  });
});

test("reflection note uses the same canonical local day as Shutdown", async () => {
  await run(
    saveTodayReflectionNoteAction,
    formData({ returnTo: "/today?finishDay=1", reflectionNote: "Win: shipped" }),
  );

  assert.deepEqual(vi.mocked(saveShutdownReflectionNote).mock.calls[0], [
    "Win: shipped",
    { localDate: "2026-11-07" },
  ]);
  assert.deepEqual(vi.mocked(revalidateWorkspaceFor).mock.calls[0], [
    "shutdown",
    { returnTo: "/today?finishDay=1" },
  ]);
});
