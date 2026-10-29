import assert from "node:assert/strict";
import test from "node:test";
import { vi } from "vitest";

import { restoreArchivedEntityAction } from "./actions";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock("@/lib/services/auth-service", () => ({
  requireAuthenticatedUser: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/lib/services/task-service", () => ({
  unarchiveTask: vi.fn(async () => ({ errorMessage: null })),
}));

vi.mock("@/lib/workspace/workspace-navigation", () => ({
  revalidateWorkspaceFor: vi.fn(),
}));

vi.mock("@ega/application", () => ({
  createAuthenticatedActor: (userId: string) => ({ userId }),
  unarchiveGoal: vi.fn(async () => ({ ok: true, data: null })),
  unarchiveProject: vi.fn(async () => ({ ok: true, data: null })),
}));

vi.mock("@ega/data-access", () => ({
  SupabaseGoalsRepository: class {},
  SupabaseProjectsRepository: class {},
}));

const { unarchiveTask } = await import("@/lib/services/task-service");
const { unarchiveGoal, unarchiveProject } = await import("@ega/application");
const { revalidateWorkspaceFor } = await import("@/lib/workspace/workspace-navigation");

function formData(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

async function captureRedirect(run: () => Promise<unknown>) {
  try {
    await run();
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/^NEXT_REDIRECT:/, "");
  }
}

test.beforeEach(() => {
  vi.clearAllMocks();
});

test("restore rejects an unknown entity before touching any service", async () => {
  const url = await captureRedirect(() =>
    restoreArchivedEntityAction(
      formData({
        entity: "backlog",
        id: "123e4567-e89b-12d3-a456-426614174000",
        returnTo: "/archive?tab=goals",
      }),
    ),
  );

  assert.equal(url, "/archive?tab=goals&archiveError=Archive+restore+request+is+invalid.");
  assert.equal(vi.mocked(unarchiveTask).mock.calls.length, 0);
  assert.equal(vi.mocked(unarchiveGoal).mock.calls.length, 0);
  assert.equal(vi.mocked(unarchiveProject).mock.calls.length, 0);
});

test("restore rejects a non-uuid id", async () => {
  const url = await captureRedirect(() =>
    restoreArchivedEntityAction(formData({ entity: "tasks", id: "../task-1" })),
  );

  assert.equal(url, "/archive?archiveError=Choose+a+valid+archived+item+to+restore.");
  assert.equal(vi.mocked(unarchiveTask).mock.calls.length, 0);
});

test("restore keeps redirect targets inside /archive", async () => {
  const attempt = await captureRedirect(() =>
    restoreArchivedEntityAction(
      formData({
        entity: "tasks",
        id: "123e4567-e89b-12d3-a456-426614174000",
        returnTo: "https://example.com/steal",
      }),
    ),
  );
  assert.equal(attempt, "/archive?archiveNotice=restored");

  const protocolRelative = await captureRedirect(() =>
    restoreArchivedEntityAction(
      formData({
        entity: "tasks",
        id: "123e4567-e89b-12d3-a456-426614174000",
        returnTo: "//archive.evil/steal",
      }),
    ),
  );
  assert.equal(protocolRelative, "/archive?archiveNotice=restored");
});

test("task restore calls the canonical task unarchive and reports success", async () => {
  const url = await captureRedirect(() =>
    restoreArchivedEntityAction(
      formData({
        entity: "tasks",
        id: "123e4567-e89b-12d3-a456-426614174000",
        returnTo: "/archive?tab=tasks&q=ship",
      }),
    ),
  );

  assert.equal(url, "/archive?tab=tasks&q=ship&archiveNotice=restored");
  assert.deepEqual(vi.mocked(unarchiveTask).mock.calls[0], [
    "123e4567-e89b-12d3-a456-426614174000",
  ]);
  assert.equal(vi.mocked(revalidateWorkspaceFor).mock.calls[0]?.[0], "task");
  assert.equal(vi.mocked(unarchiveGoal).mock.calls.length, 0);
});

test("task restore surfaces the service error instead of success", async () => {
  vi.mocked(unarchiveTask).mockResolvedValueOnce({
    errorMessage: "Task was not found or is no longer available.",
  });

  const url = await captureRedirect(() =>
    restoreArchivedEntityAction(
      formData({
        entity: "tasks",
        id: "123e4567-e89b-12d3-a456-426614174000",
        returnTo: "/archive",
      }),
    ),
  );

  assert.ok(url.includes("archiveError=Task+was+not+found"));
  assert.ok(!url.includes("archiveNotice"));
});

test("goal and project restores use their canonical application services", async () => {
  const goalUrl = await captureRedirect(() =>
    restoreArchivedEntityAction(
      formData({
        entity: "goals",
        id: "223e4567-e89b-12d3-a456-426614174000",
        returnTo: "/archive?tab=goals",
      }),
    ),
  );
  assert.equal(goalUrl, "/archive?tab=goals&archiveNotice=restored");
  assert.equal(vi.mocked(unarchiveGoal).mock.calls[0]?.[2]?.goalId, "223e4567-e89b-12d3-a456-426614174000");
  assert.equal(vi.mocked(unarchiveProject).mock.calls.length, 0);

  vi.mocked(unarchiveProject).mockResolvedValueOnce({
    ok: false,
    errorMessage: "Unable to update project right now.",
  });
  const projectUrl = await captureRedirect(() =>
    restoreArchivedEntityAction(
      formData({
        entity: "projects",
        id: "323e4567-e89b-12d3-a456-426614174000",
        returnTo: "/archive?tab=projects",
      }),
    ),
  );
  assert.ok(projectUrl.includes("archiveError=Unable+to+update+project+right+now."));
  assert.equal(vi.mocked(unarchiveProject).mock.calls[0]?.[2]?.projectId, "323e4567-e89b-12d3-a456-426614174000");
});

test("the archive action module exposes restore only", async () => {
  const module = await import("./actions");
  assert.deepEqual(Object.keys(module), ["restoreArchivedEntityAction"]);
});
