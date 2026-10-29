/**
 * URL contract for the selected-task drawer.
 *
 * Kept free of React/Next imports so server pages, server components and the
 * client hook all read and write the same parameters. `?task=` selects the
 * task; `?taskMode=full` opens the same detail as a full page. `view` already
 * means Current/Archived/All on `/tasks`, so the drawer never reuses it.
 */

/** Query parameter holding the selected task id. */
export const TASK_DRAWER_PARAM = "task";
/** `?taskMode=full` renders the same detail as a full page instead of a panel. */
export const TASK_DRAWER_MODE_PARAM = "taskMode";

export type TaskDrawerMode = "panel" | "full";

export type TaskDrawerParamState = {
  taskId: string | null;
  mode: TaskDrawerMode;
};

export function readTaskDrawerParam(
  params: URLSearchParams,
  defaultMode: TaskDrawerMode = "panel",
): TaskDrawerParamState {
  const taskId = params.get(TASK_DRAWER_PARAM)?.trim() || null;
  const rawMode = params.get(TASK_DRAWER_MODE_PARAM);
  const mode: TaskDrawerMode =
    rawMode === "full" ? "full" : rawMode === "panel" ? "panel" : defaultMode;
  return { taskId, mode };
}

/**
 * Build an href with the drawer parameters applied or removed.
 *
 * Every other parameter (view, layout, tab, filters, sort, density) is preserved
 * verbatim, so opening or closing the drawer never disturbs the list state.
 */
export function buildTaskDrawerHref(
  pathname: string,
  current: URLSearchParams,
  next: { taskId: string | null; mode?: TaskDrawerMode },
): string {
  const params = new URLSearchParams(current.toString());

  if (next.taskId) {
    params.set(TASK_DRAWER_PARAM, next.taskId);
    if (next.mode === "full") params.set(TASK_DRAWER_MODE_PARAM, "full");
    else params.delete(TASK_DRAWER_MODE_PARAM);
  } else {
    params.delete(TASK_DRAWER_PARAM);
    params.delete(TASK_DRAWER_MODE_PARAM);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Append `?task=<id>` to an existing in-app path, preserving its query and
 * drop any stale full-page mode. Used by server-rendered entry points (Today,
 * project rows) that only have the current pathname + search string.
 */
export function buildTaskDrawerLink(returnTo: string, taskId: string): string {
  const queryStart = returnTo.indexOf("?");
  const pathname = queryStart === -1 ? returnTo : returnTo.slice(0, queryStart);
  const query = queryStart === -1 ? "" : returnTo.slice(queryStart + 1);
  return buildTaskDrawerHref(pathname, new URLSearchParams(query), { taskId });
}
