"use client";

import { useCallback, useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Query parameter holding the selected task id. */
export const TASK_DRAWER_PARAM = "task";
/** `?taskMode=full` renders the same detail as a full page instead of a panel. */
export const TASK_DRAWER_MODE_PARAM = "taskMode";

export type TaskDrawerMode = "panel" | "full";

export type TaskDrawerParamState = {
  taskId: string | null;
  mode: TaskDrawerMode;
};

/**
 * Read the drawer state from a query string.
 *
 * `taskMode=full` is deliberately a separate parameter from the existing `view`
 * (Current/Archived/All), which already owns that name on `/tasks`.
 */
export function readTaskDrawerParam(params: URLSearchParams): TaskDrawerParamState {
  const taskId = params.get(TASK_DRAWER_PARAM)?.trim() || null;
  const mode = params.get(TASK_DRAWER_MODE_PARAM) === "full" ? "full" : "panel";
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
 * URL-backed task drawer state.
 *
 * Opening pushes a history entry so Back closes the drawer; every in-drawer
 * change (mode switch, explicit close) replaces the current entry so editing a
 * task does not fill the history stack.
 */
export function useTaskDrawerParam() {
  const pathname = usePathname();
  const router = useRouter();
  const rawSearchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const searchParams = useMemo(
    () => new URLSearchParams(rawSearchParams.toString()),
    [rawSearchParams],
  );
  const state = useMemo(() => readTaskDrawerParam(searchParams), [searchParams]);

  const open = useCallback(
    (taskId: string, options?: { mode?: TaskDrawerMode }) => {
      const href = buildTaskDrawerHref(pathname, searchParams, {
        taskId,
        mode: options?.mode ?? "panel",
      });
      startTransition(() => router.push(href, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  const setMode = useCallback(
    (mode: TaskDrawerMode) => {
      if (!state.taskId) return;
      const href = buildTaskDrawerHref(pathname, searchParams, { taskId: state.taskId, mode });
      startTransition(() => router.replace(href, { scroll: false }));
    },
    [pathname, router, searchParams, state.taskId],
  );

  const close = useCallback(() => {
    const href = buildTaskDrawerHref(pathname, searchParams, { taskId: null });
    startTransition(() => router.replace(href, { scroll: false }));
  }, [pathname, router, searchParams]);

  return { ...state, isPending, open, setMode, close };
}
