"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const TASK_HASH_PATTERN = /^#task-([A-Za-z0-9_-]+)$/;

/** Returns the Task id from a legacy `#task-<id>` project deep link. */
export function getTaskIdFromHash(hash: string) {
  return TASK_HASH_PATTERN.exec(hash)?.[1] ?? null;
}

/**
 * Keeps existing `#task-<id>` links working now that the task list lives in the
 * List tab: switch to List first, then scroll to the task row.
 */
export function ProjectTaskHashLink({ activeTab }: { activeTab: string }) {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    const taskId = getTaskIdFromHash(hash);
    if (!taskId) return;

    if (activeTab !== "list") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "list");
      router.replace(`${url.pathname}${url.search}${hash}`, { scroll: false });
      return;
    }

    const element = document.getElementById(`task-${taskId}`);
    if (!element) return;

    const frame = requestAnimationFrame(() => {
      element.scrollIntoView({ block: "start" });
    });

    return () => cancelAnimationFrame(frame);
  }, [activeTab, router]);

  return null;
}
