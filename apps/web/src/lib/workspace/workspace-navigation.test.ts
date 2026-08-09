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

// ── Revalidation deduplication and normalization tests ──

test("task mutation invalidates task-affected workspace paths without duplication", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "task",
    { returnTo: "/tasks?status=blocked" },
    revalidateRecorder.dependency,
  );

  // No duplicate paths: /tasks appears exactly once, deduped from returnTo normalization
  assert.equal(revalidateRecorder.calls.length, 6);
  assert.deepEqual(revalidateRecorder.calls, [
    "/tasks",
    "/tasks/projects",
    "/dashboard",
    "/today",
    "/timer",
    "/review",
  ]);
});

test("task mutation with returnTo to a unique path includes it deduped", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "task",
    { returnTo: "/tasks/projects?view=grid" },
    revalidateRecorder.dependency,
  );

  // /tasks/projects is already in the list; query string normalized out, deduped
  assert.equal(revalidateRecorder.calls.length, 6);
  assert.deepEqual(revalidateRecorder.calls, [
    "/tasks",
    "/tasks/projects",
    "/dashboard",
    "/today",
    "/timer",
    "/review",
  ]);
});

test("task mutation with returnTo to different path includes it", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "task",
    { returnTo: "/dashboard?tab=overview" },
    revalidateRecorder.dependency,
  );

  // /dashboard is already in the list, so returnTo normalizes and dedupes
  assert.equal(revalidateRecorder.calls.length, 6);
  assert.deepEqual(revalidateRecorder.calls, [
    "/tasks",
    "/tasks/projects",
    "/dashboard",
    "/today",
    "/timer",
    "/review",
  ]);
});

test("timer mutation invalidates timer-affected paths without duplication", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "timer",
    { returnTo: "/dashboard?from=timer" },
    revalidateRecorder.dependency,
  );

  // No duplicate /dashboard — normalized and deduped
  assert.equal(revalidateRecorder.calls.length, 5);
  assert.deepEqual(revalidateRecorder.calls, [
    "/timer",
    "/tasks",
    "/dashboard",
    "/today",
    "/review",
  ]);
});

test("timer mutation with returnTo to /tasks dedupes without duplicate", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "timer",
    { returnTo: "/tasks?status=blocked" },
    revalidateRecorder.dependency,
  );

  // /tasks normalized from returnTo, but already in list — no duplicate
  assert.equal(revalidateRecorder.calls.length, 5);
  assert.deepEqual(revalidateRecorder.calls, [
    "/timer",
    "/tasks",
    "/dashboard",
    "/today",
    "/review",
  ]);
});

test("timer stop mutation still invalidates all timer-dependent surfaces", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "timer",
    { returnTo: "/timer?stoppedTaskId=task-1" },
    revalidateRecorder.dependency,
  );

  // Timer stop affects: /timer (itself), /tasks (shows running timer), /dashboard (timer summary), /today, /review
  assert.equal(revalidateRecorder.calls.length, 5);
  assert.deepEqual(revalidateRecorder.calls, [
    "/timer",
    "/tasks",
    "/dashboard",
    "/today",
    "/review",
  ]);
});

test("today mutation invalidates today-affected paths without duplication", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "today",
    { returnTo: "/today?panel=planned" },
    revalidateRecorder.dependency,
  );

  // No duplicate /today — normalized and deduped
  assert.equal(revalidateRecorder.calls.length, 5);
  assert.deepEqual(revalidateRecorder.calls, [
    "/today",
    "/dashboard",
    "/tasks",
    "/timer",
    "/review",
  ]);
});

test("today mutation with returnTo to /dashboard dedupes", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "today",
    { returnTo: "/dashboard?from=today" },
    revalidateRecorder.dependency,
  );

  // /dashboard is already in the set — no duplicate
  assert.equal(revalidateRecorder.calls.length, 5);
  assert.deepEqual(revalidateRecorder.calls, [
    "/today",
    "/dashboard",
    "/tasks",
    "/timer",
    "/review",
  ]);
});

test("startup mutation invalidates startup-affected paths without duplication", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "startup",
    { returnTo: "/today?from=startup" },
    revalidateRecorder.dependency,
  );

  // No duplicate /today — normalized and deduped
  assert.equal(revalidateRecorder.calls.length, 6);
  assert.deepEqual(revalidateRecorder.calls, [
    "/startup",
    "/today",
    "/tasks",
    "/dashboard",
    "/timer",
    "/review",
  ]);
});

test("startup mutation with returnTo to /startup dedupes", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "startup",
    { returnTo: "/startup?view=shortlist" },
    revalidateRecorder.dependency,
  );

  // /startup already present — no duplicate
  assert.equal(revalidateRecorder.calls.length, 6);
  assert.deepEqual(revalidateRecorder.calls, [
    "/startup",
    "/today",
    "/tasks",
    "/dashboard",
    "/timer",
    "/review",
  ]);
});

test("shutdown mutation invalidates shutdown-affected paths without duplication", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "shutdown",
    { returnTo: "/shutdown?tab=carry" },
    revalidateRecorder.dependency,
  );

  // No duplicate /shutdown — normalized and deduped
  assert.equal(revalidateRecorder.calls.length, 6);
  assert.deepEqual(revalidateRecorder.calls, [
    "/shutdown",
    "/today",
    "/dashboard",
    "/tasks",
    "/timer",
    "/review",
  ]);
});

test("shutdown mutation with returnTo to /dashboard dedupes", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "shutdown",
    { returnTo: "/dashboard?tab=goals" },
    revalidateRecorder.dependency,
  );

  // /dashboard already in set — no duplicate
  assert.equal(revalidateRecorder.calls.length, 6);
  assert.deepEqual(revalidateRecorder.calls, [
    "/shutdown",
    "/today",
    "/dashboard",
    "/tasks",
    "/timer",
    "/review",
  ]);
});

test("all mutation types produce no duplicate revalidation paths", async () => {
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  const testCases: Array<{
    mutationType: "task" | "timer" | "today" | "startup" | "shutdown";
    returnTo: string;
  }> = [
    { mutationType: "task", returnTo: "/tasks?status=blocked" },
    { mutationType: "task", returnTo: "/tasks?view=archived" },
    { mutationType: "timer", returnTo: "/timer?view=sessions" },
    { mutationType: "timer", returnTo: "/dashboard?from=timer" },
    { mutationType: "today", returnTo: "/today?panel=planned" },
    { mutationType: "today", returnTo: "/dashboard?from=today" },
    { mutationType: "startup", returnTo: "/today?from=startup" },
    { mutationType: "startup", returnTo: "/startup?view=shortlist" },
    { mutationType: "shutdown", returnTo: "/shutdown?tab=carry" },
    { mutationType: "shutdown", returnTo: "/dashboard?tab=goals" },
  ];

  for (const { mutationType, returnTo } of testCases) {
    const recorder = createRevalidateRecorder();
    revalidateWorkspaceFor(mutationType, { returnTo }, recorder.dependency);
    const unique = new Set(recorder.calls);
    assert.equal(
      recorder.calls.length,
      unique.size,
      `${mutationType} with returnTo="${returnTo}": expected ${unique.size} unique paths but got ${recorder.calls.length} total. Calls: ${JSON.stringify(recorder.calls)}`,
    );
  }
});

test("revalidation paths contain no query strings", async () => {
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  const testCases: Array<{
    mutationType: "task" | "timer" | "today" | "startup" | "shutdown";
    returnTo: string;
  }> = [
    { mutationType: "task", returnTo: "/tasks?status=blocked&page=2" },
    { mutationType: "timer", returnTo: "/timer?view=sessions&stoppedTaskId=task-1" },
    { mutationType: "today", returnTo: "/today?panel=planned&view=focus" },
    { mutationType: "startup", returnTo: "/startup?view=shortlist&from=someday" },
    { mutationType: "shutdown", returnTo: "/shutdown?tab=carry&from=done" },
  ];

  for (const { mutationType, returnTo } of testCases) {
    const recorder = createRevalidateRecorder();
    revalidateWorkspaceFor(mutationType, { returnTo }, recorder.dependency);
    for (const path of recorder.calls) {
      assert.ok(
        !path.includes("?"),
        `${mutationType} with returnTo="${returnTo}": path "${path}" contains query string`,
      );
    }
  }
});

test("returnTo=/tasks?status=blocked dedupes to single /tasks", async () => {
  const revalidateRecorder = createRevalidateRecorder();
  const { revalidateWorkspaceFor } = await import("./workspace-navigation");

  revalidateWorkspaceFor(
    "task",
    { returnTo: "/tasks?status=blocked" },
    revalidateRecorder.dependency,
  );

  // /tasks appears only once (not twice as before: explicit + getPathname(returnTo))
  const taskPaths = revalidateRecorder.calls.filter((p) => p === "/tasks");
  assert.equal(taskPaths.length, 1, `Expected exactly 1 "/tasks" call, got ${taskPaths.length}: ${JSON.stringify(revalidateRecorder.calls)}`);
});
