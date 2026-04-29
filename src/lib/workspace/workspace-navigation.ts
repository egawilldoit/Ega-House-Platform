import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const WORKSPACE_NAVIGATION_BASE_URL = "https://egawilldoit.online";

type WorkspaceNavigationDependencies = {
  redirect: (href: string) => never;
};

type WorkspaceRevalidationDependencies = {
  revalidatePath: (path: string) => void;
};

type WorkspaceFeedback = {
  anchor?: string;
  clearStoppedTaskId?: boolean;
  errorMessage?: string;
  stoppedTaskId?: string;
  successMessage?: string;
  taskErrorMessage?: string;
  taskId?: string;
  taskSuccessMessage?: string;
};

type WorkspaceMutationType =
  | "task"
  | "timer"
  | "today"
  | "startup"
  | "shutdown";

type WorkspaceRevalidationOptions = {
  returnTo: string;
};

function getPathname(href: string) {
  return new URL(href, WORKSPACE_NAVIGATION_BASE_URL).pathname;
}

function getWorkspaceRevalidationPaths(
  mutationType: WorkspaceMutationType,
  returnTo: string,
) {
  const pathSets: Record<WorkspaceMutationType, string[]> = {
    task: [
      "/tasks",
      "/tasks/projects",
      getPathname(returnTo),
      "/dashboard",
      "/today",
      "/timer",
      "/review",
    ],
    timer: [
      "/timer",
      getPathname(returnTo),
      "/tasks",
      "/dashboard",
      "/today",
      "/review",
    ],
    today: ["/today", returnTo, "/dashboard", "/tasks", "/timer", "/review"],
    startup: [
      "/startup",
      returnTo,
      "/today",
      "/tasks",
      "/dashboard",
      "/timer",
      "/review",
    ],
    shutdown: [
      "/shutdown",
      returnTo,
      "/today",
      "/dashboard",
      "/tasks",
      "/timer",
      "/review",
    ],
  };

  return pathSets[mutationType];
}

export function redirectWithWorkspaceFeedback(
  redirectTo: string,
  feedback: WorkspaceFeedback = {},
  dependencies: WorkspaceNavigationDependencies = { redirect },
): never {
  const target = new URL(redirectTo, WORKSPACE_NAVIGATION_BASE_URL);

  if (feedback.successMessage) {
    target.searchParams.set("actionSuccess", feedback.successMessage);
  }
  if (feedback.errorMessage) {
    target.searchParams.set("actionError", feedback.errorMessage);
  }
  if (feedback.stoppedTaskId) {
    target.searchParams.set("stoppedTaskId", feedback.stoppedTaskId);
  }
  if (feedback.clearStoppedTaskId && !feedback.stoppedTaskId) {
    target.searchParams.delete("stoppedTaskId");
  }
  if (feedback.taskSuccessMessage) {
    target.searchParams.set("taskUpdateSuccess", feedback.taskSuccessMessage);
  }
  if (feedback.taskErrorMessage) {
    target.searchParams.set("taskUpdateError", feedback.taskErrorMessage);
  }
  if (feedback.taskId) {
    target.searchParams.set("taskUpdateTaskId", feedback.taskId);
  }

  const hash = feedback.anchor ? `#${feedback.anchor}` : target.hash;
  return dependencies.redirect(`${target.pathname}${target.search}${hash}`);
}

export function revalidateWorkspaceFor(
  mutationType: WorkspaceMutationType,
  options: WorkspaceRevalidationOptions,
  dependencies: WorkspaceRevalidationDependencies = { revalidatePath },
) {
  for (const path of getWorkspaceRevalidationPaths(
    mutationType,
    options.returnTo,
  )) {
    dependencies.revalidatePath(path);
  }
}
