import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PERSONAL_OPERATIONS } from "@ega/domain";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/services/user-preferences-service", () => ({
  updateWebUserPreferences: vi.fn(async () => ({
    preferences: {},
    errorMessage: null,
  })),
}));
vi.mock("@/lib/services/job-search-reference-service", () => ({
  verifyJobSearchReferenceTask: vi.fn(async () => ({ ok: true, errorMessage: null })),
}));

import { verifyJobSearchReferenceTask } from "@/lib/services/job-search-reference-service";
import { updateWebUserPreferences } from "@/lib/services/user-preferences-service";
import { updatePersonalOperationsAction } from "./actions";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const update = vi.mocked(updateWebUserPreferences);
const verify = vi.mocked(verifyJobSearchReferenceTask);

function formData(options: {
  dirty?: boolean;
  reference?: string;
} = {}): FormData {
  const data = new FormData();
  data.set("schedule", JSON.stringify(DEFAULT_PERSONAL_OPERATIONS));
  data.set("jobSearchReferenceDirty", options.dirty ? "true" : "false");
  if (options.reference !== undefined) data.set("jobSearchReference", options.reference);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updatePersonalOperationsAction reference concurrency", () => {
  it("omits the reference patch for an untouched stale tab", async () => {
    const result = await updatePersonalOperationsAction(
      { message: "", ok: false },
      formData({ dirty: false, reference: `task:${TASK_ID}` }),
    );

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch).toHaveProperty("personalOperations");
    expect(patch).not.toHaveProperty("jobSearchReference");
    expect(verify).not.toHaveBeenCalled();
  });

  it("sends a verified reference only when the owner changed it", async () => {
    const result = await updatePersonalOperationsAction(
      { message: "", ok: false },
      formData({ dirty: true, reference: `task:${TASK_ID}` }),
    );

    expect(result.ok).toBe(true);
    expect(verify).toHaveBeenCalledWith({ taskId: TASK_ID });
    const patch = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch).toMatchObject({
      personalOperations: DEFAULT_PERSONAL_OPERATIONS,
      jobSearchReference: { kind: "task", id: TASK_ID },
    });
  });

  it("sends an explicit null when the owner clears the reference", async () => {
    const result = await updatePersonalOperationsAction(
      { message: "", ok: false },
      formData({ dirty: true, reference: "" }),
    );

    expect(result.ok).toBe(true);
    expect(verify).not.toHaveBeenCalled();
    const patch = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch).toHaveProperty("jobSearchReference", null);
  });

  it("rejects a malformed reference before saving", async () => {
    const result = await updatePersonalOperationsAction(
      { message: "", ok: false },
      formData({ dirty: true, reference: "project:not-a-task" }),
    );

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a foreign or unknown task before saving", async () => {
    verify.mockResolvedValueOnce({ ok: false, errorMessage: "That task is not available in your workspace." });

    const result = await updatePersonalOperationsAction(
      { message: "", ok: false },
      formData({ dirty: true, reference: `task:${TASK_ID}` }),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not available/i);
    expect(update).not.toHaveBeenCalled();
  });
});
