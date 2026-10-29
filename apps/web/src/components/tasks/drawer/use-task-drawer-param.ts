"use client";

import { useCallback, useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  TASK_DRAWER_MODE_PARAM,
  TASK_DRAWER_PARAM,
  buildTaskDrawerHref,
  readTaskDrawerParam,
  type TaskDrawerMode,
} from "@/lib/task-drawer-url";

// Re-exported for existing client callers; the URL rules themselves live in
// `lib/task-drawer-url.ts` so server components share the same contract.
export { TASK_DRAWER_MODE_PARAM, TASK_DRAWER_PARAM, buildTaskDrawerHref, readTaskDrawerParam };
export type { TaskDrawerMode };

/**
 * URL-backed task drawer state.
 *
 * `defaultMode` is the owner's durable "open tasks in" preference. An explicit
 * `?taskMode=panel|full` in the address still wins, so the drawer's own toggle
 * works for the current selection without rewriting the stored default.
 *
 * Opening pushes a history entry so Back closes the drawer; every in-drawer
 * change (mode switch, explicit close) replaces the current entry so editing a
 * task does not fill the history stack.
 */
export function useTaskDrawerParam(defaultMode: TaskDrawerMode = "panel") {
  const pathname = usePathname();
  const router = useRouter();
  const rawSearchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const searchParams = useMemo(
    () => new URLSearchParams(rawSearchParams.toString()),
    [rawSearchParams],
  );
  const state = useMemo(
    () => readTaskDrawerParam(searchParams, defaultMode),
    [searchParams, defaultMode],
  );

  const open = useCallback(
    (taskId: string, options?: { mode?: TaskDrawerMode }) => {
      const href = buildTaskDrawerHref(pathname, searchParams, {
        taskId,
        mode: options?.mode ?? defaultMode,
      });
      startTransition(() => router.push(href, { scroll: false }));
    },
    [pathname, router, searchParams, defaultMode],
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
