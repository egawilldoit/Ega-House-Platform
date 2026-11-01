import Link from "next/link";

import { StatusIcon, type TaskStatusIconName } from "@/components/ui/status-icon";
import { formatDisplayDate } from "@/lib/presentation-format";
import { isCanonicalTaskStatus } from "@/lib/task-domain";

import type { HomeTaskPreview } from "../_lib/home-page-model";

const PREVIEW_STATUSES: readonly TaskStatusIconName[] = [
  "todo",
  "in_progress",
  "review",
  "done",
  "blocked",
];

function isPreviewStatus(status: string): status is TaskStatusIconName {
  return (
    isCanonicalTaskStatus(status) && PREVIEW_STATUSES.includes(status as TaskStatusIconName)
  );
}

/**
 * Compact Home task row shared by deadlines and My tasks.
 *
 * No `data-task-id` anchor: the same task can legitimately appear in both
 * previews, and the canonical deep link already carries the exact task context.
 */
export function HomeTaskPreviewRow({ task }: { task: HomeTaskPreview }) {
  return (
    <Link href={task.href} className="row row-link min-h-11">
      {isPreviewStatus(task.status) ? (
        <StatusIcon status={task.status} decorative className="size-4 shrink-0" />
      ) : (
        <span
          className="size-4 shrink-0 rounded-full border-2 border-[color:var(--ega-border-strong)]"
          aria-hidden="true"
        />
      )}
      <span className="row-main">
        <span className="row-title">{task.title}</span>
        <span className="row-meta">
          {task.projectName ?? "No project"}
          {task.dueDate ? ` · Due ${formatDisplayDate(task.dueDate, "compact")}` : ""}
        </span>
      </span>
    </Link>
  );
}
