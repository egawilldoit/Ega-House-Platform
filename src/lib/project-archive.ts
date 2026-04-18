export const PROJECT_ARCHIVE_STATUS = "archived";
export const PROJECT_VIEW_VALUES = ["active", "archived", "all"] as const;

export type ProjectViewFilter = (typeof PROJECT_VIEW_VALUES)[number];

export function normalizeProjectViewFilter(input: unknown): ProjectViewFilter {
  const value = String(input ?? "").trim().toLowerCase();

  if (value === "archived") {
    return "archived";
  }

  if (value === "all") {
    return "all";
  }

  return "active";
}

export function isProjectArchivedStatus(status: string | null | undefined) {
  return String(status ?? "").trim().toLowerCase() === PROJECT_ARCHIVE_STATUS;
}
