/**
 * Archive centre vocabulary shared by every surface that lists archived work.
 *
 * The archive state itself is owned by persistence: tasks use
 * `archived_at`/`archived_by`, and projects/goals carry the same metadata with
 * `status = 'archived'` tied to it by a database CHECK constraint (migration
 * 0073). This module only normalises the view inputs, so the page, the read
 * model and the URL contract cannot drift apart.
 */
export const ARCHIVE_TAB_VALUES = ["tasks", "goals", "projects"] as const;

export type ArchiveTab = (typeof ARCHIVE_TAB_VALUES)[number];

export const ARCHIVE_SEARCH_MAX_LENGTH = 120;

export function isArchiveTab(value: unknown): value is ArchiveTab {
  return typeof value === "string" && (ARCHIVE_TAB_VALUES as readonly string[]).includes(value);
}

export function normalizeArchiveTab(input: unknown): ArchiveTab {
  const value = String(input ?? "").trim().toLowerCase();
  return isArchiveTab(value) ? value : "tasks";
}

/**
 * Trim, collapse internal whitespace, and bound the length of a user-supplied
 * archive search. Wildcards are escaped where the query is built, not here.
 */
export function normalizeArchiveSearchQuery(input: unknown): string {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ARCHIVE_SEARCH_MAX_LENGTH);
}
