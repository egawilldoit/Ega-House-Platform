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

const DEFAULT_WORKSPACE_NAVIGATION_DEPENDENCIES: WorkspaceNavigationDependencies = { redirect };
const DEFAULT_WORKSPACE_REVALIDATION_DEPENDENCIES: WorkspaceRevalidationDependencies = {
  revalidatePath,
};

function getPathname(href: string) {
  return new URL(href, WORKSPACE_NAVIGATION_BASE_URL).pathname;
}

function getWorkspaceRevalidationPaths(
  mutationType: WorkspaceMutationType,
  returnTo: string,
) {
  const normalizedReturnTo = getPathname(returnTo);

  // Helper: push unique pathnames only — removes duplicates from iterable sources
  const pathSets: Record<WorkspaceMutationType, string[]> = {
    task: [
      "/tasks",
      "/tasks/projects",
      "/dashboard",
      "/today",
      "/timer",
      "/review",
    ],
    timer: [
      "/timer",
      "/tasks",
      "/dashboard",
      "/today",
      "/review",
    ],
    today: [
      "/today",
      "/dashboard",
      "/tasks",
      "/timer",
      "/review",
    ],
    startup: [
      "/startup",
      "/today",
      "/tasks",
      "/dashboard",
      "/timer",
      "/review",
    ],
    shutdown: [
      "/shutdown",
      "/today",
      "/dashboard",
      "/tasks",
      "/timer",
      "/review",
    ],
  };

  // Collect base paths, then add normalized returnTo (deduped)
  const basePaths = pathSets[mutationType];
  return deduplicatePaths([...basePaths, normalizedReturnTo]);
}

function deduplicatePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

export function redirectWithWorkspaceFeedback(
  redirectTo: string,
  feedback: WorkspaceFeedback = {},
  dependencies: WorkspaceNavigationDependencies = DEFAULT_WORKSPACE_NAVIGATION_DEPENDENCIES,
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
  dependencies: WorkspaceRevalidationDependencies = DEFAULT_WORKSPACE_REVALIDATION_DEPENDENCIES,
) {
  for (const path of getWorkspaceRevalidationPaths(
    mutationType,
    options.returnTo,
  )) {
    dependencies.revalidatePath(path);
  }
}
