import assert from "node:assert/strict";
import test from "node:test";
import { vi } from "vitest";
import { queueTaskForTomorrow } from "@/lib/services/shutdown-service";

import { getShutdownReturnPath, carryForwardTaskToTomorrowAction } from "./actions";

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
  getWebTimeContext: vi.fn(async () => ({ localDate: "2026-04-21" })),
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
