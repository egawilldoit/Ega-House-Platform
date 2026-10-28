import type { TaskPriority, TaskStatus } from "./status";

/**
 * Canonical rank used when the shared sort field is `priority`.
 * Higher value = higher priority, so `priority_desc` puts urgent first.
 */
export const TASK_PRIORITY_SORT_RANK: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};

/**
 * Canonical workflow rank used when the shared sort field is `status`.
 * Done sorts last so open work stays at the top of an ascending status list.
 */
export const TASK_STATUS_SORT_RANK: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 1,
  review: 2,
  blocked: 3,
  done: 4,
};

export type TaskSortFieldValue = string | number | null | undefined;
export type TaskSortDirection = "asc" | "desc";

// A fixed locale keeps title ordering deterministic across server/client
// runtimes. Numeric collation makes "Task 2" sort before "Task 10".
const titleCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function rankOf<T extends string>(rank: Record<T, number>, value: TaskSortFieldValue): number {
  if (typeof value !== "string") return -1;
  return rank[value as T] ?? -1;
}

function compareNullableAscending(
  left: TaskSortFieldValue,
  right: TaskSortFieldValue,
): number {
  const leftMissing = left === null || left === undefined || left === "";
  const rightMissing = right === null || right === undefined || right === "";
  // Missing values stay last in both directions; sorting a list should not
  // bury every real value behind a page of blanks when the direction flips.
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

/**
 * Compare two already-extracted task field values using the shared sort
 * semantics. Callers own the row shape; this function owns ordering policy.
 */
export function compareTaskField(
  field: "title" | "due" | "priority" | "status" | "estimate" | "updated",
  direction: TaskSortDirection,
  left: TaskSortFieldValue,
  right: TaskSortFieldValue,
): number {
  let ascending: number;

  switch (field) {
    case "title": {
      const leftTitle = String(left ?? "");
      const rightTitle = String(right ?? "");
      ascending = titleCollator.compare(leftTitle, rightTitle);
      break;
    }
    case "priority":
      ascending =
        rankOf(TASK_PRIORITY_SORT_RANK, left) - rankOf(TASK_PRIORITY_SORT_RANK, right);
      break;
    case "status":
      ascending = rankOf(TASK_STATUS_SORT_RANK, left) - rankOf(TASK_STATUS_SORT_RANK, right);
      break;
    case "updated": {
      const leftTime = typeof left === "string" ? Date.parse(left) : Number.NaN;
      const rightTime = typeof right === "string" ? Date.parse(right) : Number.NaN;
      ascending =
        Number.isFinite(leftTime) && Number.isFinite(rightTime)
          ? leftTime - rightTime
          : compareNullableAscending(left, right);
      break;
    }
    case "due":
    case "estimate":
      ascending = compareNullableAscending(left, right);
      break;
    default:
      ascending = 0;
  }

  return direction === "asc" ? ascending : -ascending;
}

/** Deterministic final tie-breaker so equal sort keys never reorder randomly. */
export function compareTaskIds(left: string, right: string): number {
  return left.localeCompare(right);
}
