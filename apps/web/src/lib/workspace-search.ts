export const WORKSPACE_SEARCH_MIN_QUERY_LENGTH = 2;

export const WORKSPACE_SEARCH_MAX_QUERY_LENGTH = 120;

/** Search scopes shown as tabs in the command palette (client-safe). */
export const WORKSPACE_SEARCH_SCOPES = ["all", "tasks", "projects", "goals", "ideas"] as const;
export type WorkspaceSearchScope = (typeof WORKSPACE_SEARCH_SCOPES)[number];

export function normalizeWorkspaceSearchScope(rawScope: unknown): WorkspaceSearchScope {
  const normalized = String(rawScope ?? "").trim().toLowerCase();
  return (WORKSPACE_SEARCH_SCOPES as readonly string[]).includes(normalized)
    ? (normalized as WorkspaceSearchScope)
    : "all";
}
