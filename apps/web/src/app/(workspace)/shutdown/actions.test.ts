import assert from "node:assert/strict";
import test from "node:test";
import { vi } from "vitest";
import { queueTaskForTomorrow } from "@/lib/services/shutdown-service";

import { saveWebDailyCheckin } from "@/lib/services/checkin-service";

import { getShutdownReturnPath, carryForwardTaskToTomorrowAction, saveDailyCheckinAction } from "./actions";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));

vi.mock("@/lib/services/shutdown-service", () => ({
  queueTaskForTomorrow: vi.fn(async () => ({
    errorMessage: null,
    title: "QA carry today",
    tomorrowDate: "2026-04-22",
  })),
  saveShutdownReflectionNote: vi.fn(async () => ({ errorMessage: null })),
}));

vi.mock("@/lib/services/time-context-service", () => ({
  getWebTimeContext: vi.fn(async () => ({ localDate: "2026-04-21", timezone: "Africa/Casablanca" })),
}));

vi.mock("@/lib/services/checkin-service", () => ({
  saveWebDailyCheckin: vi.fn(async () => ({
    checkin: null,
    overtimeAdvisory: null,
    errorMessage: null,
  })),
}));

test("shutdown actions keep return paths scoped to /shutdown", async () => {
  assert.equal(await getShutdownReturnPath("/shutdown"), "/shutdown");
  assert.equal(await getShutdownReturnPath("/shutdown?tab=carry"), "/shutdown?tab=carry");
  assert.equal(await getShutdownReturnPath("/today"), "/shutdown");
  assert.equal(await getShutdownReturnPath("https://example.com"), "/shutdown");
});

async function captureRedirect(run: () => Promise<void>) {
  try {
    await run();
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/NEXT_REDIRECT:(.*)/);
    return match ? match[1] : message;
  }
}

test("daily check-in action saves bounded fields and surfaces the advisory", async () => {
  vi.mocked(saveWebDailyCheckin).mockResolvedValueOnce({
    checkin: null,
    overtimeAdvisory: "This week already has 3 overtime evenings.",
    errorMessage: null,
  });
  const formData = new FormData();
  formData.set("localDate", "2026-04-21");
  formData.set("outcomes", "Shipped the planner");
  formData.set("personalMinutes", "30");
  formData.set("overtimeMinutes", "45");
  formData.set("overtimeReason", "Release");

  const url = await captureRedirect(async () => {
    await saveDailyCheckinAction(formData);
  });
  assert.ok(url.includes("actionSuccess=Check-in+saved"));
  assert.ok(url.includes("3+overtime+evenings"));
  const input = vi.mocked(saveWebDailyCheckin).mock.lastCall?.[0];
  assert.equal(input?.localDate, "2026-04-21");
  assert.equal(input?.timezone, "Africa/Casablanca");
  assert.equal(input?.patch.personalMinutes, 30);
  assert.equal(input?.patch.overtimeMinutes, 45);
});

test("daily check-in action rejects non-integer minutes and surfaces service errors", async () => {
  const bad = new FormData();
  bad.set("personalMinutes", "1.5");
  const badUrl = await captureRedirect(async () => {
    await saveDailyCheckinAction(bad);
  });
  assert.ok(badUrl.includes("actionError="));
  assert.ok(badUrl.includes("whole+minutes"));

  vi.mocked(saveWebDailyCheckin).mockResolvedValueOnce({
    checkin: null,
    overtimeAdvisory: null,
    errorMessage: "Overtime needs a short reason.",
  });
  const formData = new FormData();
  const url = await captureRedirect(async () => {
    await saveDailyCheckinAction(formData);
  });
  assert.ok(url.includes("actionError=Overtime+needs+a+short+reason"));
});

test("carry intent success message names the task and target date", async () => {
  const formData = new FormData();
  formData.set("taskId", "task-1");
  formData.set("intent", "carry");
  const url = await captureRedirect(async () => {
    await carryForwardTaskToTomorrowAction(formData);
  });
  assert.ok(url.includes('actionSuccess=Carried+%22QA+carry+today%22+to+Apr+22%2C+2026'));
  assert.deepEqual(vi.mocked(queueTaskForTomorrow).mock.lastCall, [
    "task-1", { localDate: "2026-04-21", intent: "carry" },
  ]);
});

test("add intent keeps the distinct queued message", async () => {
  const formData = new FormData();
  formData.set("taskId", "task-1");
  formData.set("intent", "add");
  const url = await captureRedirect(async () => {
    await carryForwardTaskToTomorrowAction(formData);
  });
  assert.ok(url.includes("actionSuccess=Task+queued+for+tomorrow."));
});

test("carry failure reports an error instead of success", async () => {
  vi.mocked(queueTaskForTomorrow).mockResolvedValueOnce({
    errorMessage: "Task is unavailable.",
  });
  const formData = new FormData();
  formData.set("taskId", "task-1");
  formData.set("intent", "carry");
  const url = await captureRedirect(async () => {
    await carryForwardTaskToTomorrowAction(formData);
  });
  assert.ok(url.includes("actionError=Task+is+unavailable."));
});

test("missing or unknown intent preserves add semantics", async () => {
  for (const intent of [null, "unknown"]) {
    const formData = new FormData();
    formData.set("taskId", "task-1");
    if (intent !== null) formData.set("intent", intent);
    const url = await captureRedirect(() => carryForwardTaskToTomorrowAction(formData));
    assert.ok(url.includes("actionSuccess=Task+queued+for+tomorrow."));
    assert.deepEqual(vi.mocked(queueTaskForTomorrow).mock.lastCall, [
      "task-1", { localDate: "2026-04-21", intent: "add" },
    ]);
  }
});
