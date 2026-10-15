import { beforeEach, expect, it, vi } from "vitest";
import { createTasks, validateTaskInlineUpdateInput } from "./task-service";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));
const insert = vi.fn();
beforeEach(() => {
  insert.mockReset().mockReturnValue({ select: async () => ({ data: [{ id: "task-1" }], error: null }) });
  createClient.mockResolvedValue({ from: (table: string) => {
    if (table === "projects") return { select: async () => ({ data: [{ id: "project-1" }], error: null }) };
    if (table === "goals") return { select: async () => ({ data: [], error: null }) };
    if (table === "tasks") return { insert };
    throw new Error(`Unexpected table: ${table}`);
  } });
});
const row = (length: number) => ({ title: "x".repeat(length), project_id: "project-1", status: "todo", priority: "medium" });
it("rejects 257 characters before an insert or inline update", async () => {
  expect((await createTasks([row(257)])).errorMessage).toBe("Title must be 256 characters or fewer.");
  expect(insert).not.toHaveBeenCalled();
  expect(validateTaskInlineUpdateInput({ taskId: "task-1", title: row(257).title, status: "todo", priority: "medium", dueDate: "", estimateMinutes: "", blockedReason: "" }).errorMessage).toBe("Title must be 256 characters or fewer.");
});
it.each([250, 256])("accepts a %i character title", async length => {
  expect((await createTasks([row(length)])).errorMessage).toBeNull();
  expect(insert).toHaveBeenCalledOnce();
});
it("maps Postgres length errors to actionable feedback", async () => {
  insert.mockReturnValue({ select: async () => ({ data: null, error: { code: "22001", message: "private detail" } }) });
  expect((await createTasks([row(10)])).errorMessage).toBe("Title must be 256 characters or fewer.");
});
