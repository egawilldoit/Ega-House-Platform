export const GOAL_ARCHIVE_STATUS = "archived";
export const GOAL_VIEW_VALUES = ["active", "archived", "all"] as const;

export type GoalViewFilter = (typeof GOAL_VIEW_VALUES)[number];

export function normalizeGoalViewFilter(input: unknown): GoalViewFilter {
  const value = String(input ?? "").trim().toLowerCase();

  if (value === "archived") {
    return "archived";
  }

  if (value === "all") {
    return "all";
  }

  return "active";
}

export function isGoalArchivedStatus(status: string | null | undefined) {
  return String(status ?? "").trim().toLowerCase() === GOAL_ARCHIVE_STATUS;
}
