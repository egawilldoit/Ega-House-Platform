import { beforeEach, expect, it, vi } from "vitest";
import { createTaskAction } from "./actions";
import { buildCreateTaskFormInitialState } from "./create-task-form";
import { createTaskWithOptionalWorkedTime } from "@/lib/services/task-service";

vi.mock("@/lib/services/time-context-service", () => ({ getWebTimeContext: async () => ({ timezone: "UTC", localDate: "2026-10-15" }) }));
vi.mock("@/lib/workspace/workspace-navigation", () => ({ revalidateWorkspaceFor: vi.fn(), redirectWithWorkspaceFeedback: vi.fn() }));
vi.mock("@/lib/services/task-service", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/services/task-service")>(),
  createTaskWithOptionalWorkedTime: vi.fn(),
  getTaskScopeSnapshot: async () => ({ errorMessage: null, data: { projectIds: new Set(["project-1"]), goalsById: new Map() } }),
}));
beforeEach(() => {
  vi.mocked(createTaskWithOptionalWorkedTime).mockReset().mockResolvedValue({ errorMessage: null, createdTaskId: "task-1", workedTimeLogged: false });
});
const initial = buildCreateTaskFormInitialState({ projects: [{ id: "project-1", name: "Project" }] }).initialState;
function form(length: number) {
  const data = new FormData();
  data.set("title", "x".repeat(length));
  data.set("projectId", "project-1");
  return data;
}
it("rejects an over-limit title with field feedback before writing", async () => {
  const result = await createTaskAction(initial, form(257));
  expect(result.error).toBe("Title must be 256 characters or fewer.");
  expect(result.titleError).toBe(result.error);
  expect(createTaskWithOptionalWorkedTime).not.toHaveBeenCalled();
});
it("accepts a 250-character title", async () => {
  const result = await createTaskAction(initial, form(250));
  expect(result.error).toBeNull();
  expect(createTaskWithOptionalWorkedTime).toHaveBeenCalledOnce();
});
