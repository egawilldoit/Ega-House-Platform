import assert from "node:assert/strict";
import test from "node:test";

function createRedirectRecorder() {
  const calls: string[] = [];
  return {
    calls,
    dependency: {
      redirect: (href: string) => {
        calls.push(href);
        throw new Error("NEXT_REDIRECT");
      },
    },
  };
}

function createRevalidateRecorder() {
  const calls: string[] = [];
  return {
    calls,
    dependency: {
      revalidatePath: (path: string) => {
        calls.push(path);
      },
    },
  };
}

test("success redirect preserves workspace feedback URL format", async () => {
  const redirectRecorder = createRedirectRecorder();
  const { redirectWithWorkspaceFeedback } = await import("./workspace-navigation");

  assert.throws(
    () =>
      redirectWithWorkspaceFeedback("/startup?view=shortlist", {
        successMessage: "1 startup task added to Today.",
      }, redirectRecorder.dependency),
    /NEXT_REDIRECT/,
  );

  assert.deepEqual(redirectRecorder.calls, [
    "/startup?view=shortlist&actionSuccess=1+startup+task+added+to+Today.",
  ]);
});

test("error redirect preserves workspace feedback URL format", async () => {
  const redirectRecorder = createRedirectRecorder();
  const { redirectWithWorkspaceFeedback } = await import("./workspace-navigation");

  assert.throws(
    () =>
      redirectWithWorkspaceFeedback("/today?view=focus", {
        errorMessage: "Blocked reason is required when status is Blocked.",
      }, redirectRecorder.dependency),
    /NEXT_REDIRECT/,
  );

  assert.deepEqual(redirectRecorder.calls, [
    "/today?view=focus&actionError=Blocked+reason+is+required+when+status+is+Blocked.",
  ]);
});

test("task success redirect preserves task update feedback URL format", async () => {
  const redirectRecorder = createRedirectRecorder();
  const { redirectWithWorkspaceFeedback } = await import("./workspace-navigation");

  assert.throws(
    () =>
      redirectWithWorkspaceFeedback(
        "/tasks?view=archived",
        {
          taskSuccessMessage: "Task restored.",
          anchor: "task-task-1",
        },
        redirectRecorder.dependency,
      ),
    /NEXT_REDIRECT/,
  );

  assert.deepEqual(redirectRecorder.calls, [
    "/tasks?view=archived&taskUpdateSuccess=Task+restored.#task-task-1",
  ]);
});

test("task error redirect preserves task update feedback URL format", async () => {
  const redirectRecorder = createRedirectRecorder();
  const { redirectWithWorkspaceFeedback } = await import("./workspace-navigation");

  assert.throws(
    () =>
      redirectWithWorkspaceFeedback(
        "/tasks?status=blocked",
        {
          taskErrorMessage: "Task update request is invalid.",
          taskId: "task-1",
          anchor: "task-task-1",
        },
        redirectRecorder.dependency,
      ),
    /NEXT_REDIRECT/,
  );

  assert.deepEqual(redirectRecorder.calls, [
    "/tasks?status=blocked&taskUpdateError=Task+update+request+is+invalid.&taskUpdateTaskId=task-1#task-task-1",
  ]);
});

test("redirect without feedback preserves existing return path", async () => {
  const redirectRecorder = createRedirectRecorder();
  const { redirectWithWorkspaceFeedback } = await import("./workspace-navigation");

  assert.throws(
    () =>
      redirectWithWorkspaceFeedback(
        "/today?view=focus#planned",
        undefined,
        redirectRecorder.dependency,
      ),
    /NEXT_REDIRECT/,
  );

  assert.deepEqual(redirectRecorder.calls, ["/today?view=focus#planned"]);
});

test("timer stopped-task redirect preserves timer feedback URL format", async () => {
  const redirectRecorder = createRedirectRecorder();
  const { redirectWithWorkspaceFeedback } = await import("./workspace-navigation");

  assert.throws(
    () =>
      redirectWithWorkspaceFeedback(
        "/timer?stoppedTaskId=old",
        {
          successMessage: "Timer stopped. Choose the task outcome.",
          stoppedTaskId: "task-1",
        },
        redirectRecorder.dependency,
      ),
    /NEXT_REDIRECT/,
  );

  assert.deepEqual(redirectRecorder.calls, [
    "/timer?stoppedTaskId=task-1&actionSuccess=Timer+stopped.+Choose+the+task+outcome.",
  ]);
});

test("timer redirect clears stale stopped task feedback when no stopped task is provided", async () => {
  const redirectRecorder = createRedirectRecorder();
  const { redirectWithWorkspaceFeedback } = await import("./workspace-navigation");

  assert.throws(
    () =>
      redirectWithWorkspaceFeedback(
        "/timer?stoppedTaskId=old&view=sessions",
        { clearStoppedTaskId: true },
        redirectRecorder.dependency,
      ),
    /NEXT_REDIRECT/,
  );

  assert.deepEqual(redirectRecorder.calls, ["/timer?view=sessions"]);
});

test("task mutation invalidates all task-affected workspace paths", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "task",
    { returnTo: "/tasks?status=blocked" },
    revalidateRecorder.dependency,
  );

  assert.deepEqual(revalidateRecorder.calls, [
    "/tasks",
    "/tasks/projects",
    "/tasks",
    "/dashboard",
    "/today",
    "/timer",
    "/review",
  ]);
});

test("timer mutation invalidates all timer-affected workspace paths", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "timer",
    { returnTo: "/dashboard?from=timer" },
    revalidateRecorder.dependency,
  );

  assert.deepEqual(revalidateRecorder.calls, [
    "/timer",
    "/dashboard",
    "/tasks",
    "/dashboard",
    "/today",
    "/review",
  ]);
});

test("today mutation invalidates all today-affected workspace paths", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "today",
    { returnTo: "/today?panel=planned" },
    revalidateRecorder.dependency,
  );

  assert.deepEqual(revalidateRecorder.calls, [
    "/today",
    "/today?panel=planned",
    "/dashboard",
    "/tasks",
    "/timer",
    "/review",
  ]);
});

test("startup mutation invalidates all startup-affected workspace paths", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "startup",
    { returnTo: "/today?from=startup" },
    revalidateRecorder.dependency,
  );

  assert.deepEqual(revalidateRecorder.calls, [
    "/startup",
    "/today?from=startup",
    "/today",
    "/tasks",
    "/dashboard",
    "/timer",
    "/review",
  ]);
});

test("shutdown mutation invalidates all shutdown-affected workspace paths", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "shutdown",
    { returnTo: "/shutdown?tab=carry" },
    revalidateRecorder.dependency,
  );

  assert.deepEqual(revalidateRecorder.calls, [
    "/shutdown",
    "/shutdown?tab=carry",
    "/today",
    "/dashboard",
    "/tasks",
    "/timer",
    "/review",
  ]);
});
