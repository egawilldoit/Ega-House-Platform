import { excludeArchivedAncestry, loadArchivedAncestorScope } from "@ega/data-access";

import { createClient } from "@/lib/supabase/server";
import {
  WORKSPACE_SEARCH_MAX_QUERY_LENGTH,
  WORKSPACE_SEARCH_MIN_QUERY_LENGTH,
  normalizeWorkspaceSearchScope,
  type WorkspaceSearchScope,
} from "@/lib/workspace-search";

// The scope list is defined in the client-safe module so the palette never
// imports this server module (which depends on next/headers).
export { WORKSPACE_SEARCH_SCOPES, normalizeWorkspaceSearchScope } from "@/lib/workspace-search";
export type { WorkspaceSearchScope } from "@/lib/workspace-search";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type WorkspaceSearchTaskHit = {
  id: string;
  title: string;
  status: string;
  projectName: string | null;
};

export type WorkspaceSearchProjectHit = {
  id: string;
  name: string;
  slug: string | null;
};

export type WorkspaceSearchGoalHit = {
  id: string;
  title: string;
};

export type WorkspaceSearchIdeaHit = {
  id: string;
  title: string;
  status: string;
};

export type WorkspaceSearchResults = {
  query: string;
  scope: WorkspaceSearchScope;
  tasks: WorkspaceSearchTaskHit[];
  projects: WorkspaceSearchProjectHit[];
  goals: WorkspaceSearchGoalHit[];
  ideas: WorkspaceSearchIdeaHit[];
};

const TASK_LIMIT = 6;
const PROJECT_LIMIT = 4;
const GOAL_LIMIT = 4;
const IDEA_LIMIT = 4;

function escapePostgrestPattern(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function normalizeWorkspaceSearchQuery(rawQuery: unknown): string {
  return String(rawQuery ?? "").trim().slice(0, WORKSPACE_SEARCH_MAX_QUERY_LENGTH);
}

function emptyResults(query: string, scope: WorkspaceSearchScope): WorkspaceSearchResults {
  return { query, scope, tasks: [], projects: [], goals: [], ideas: [] };
}

/**
 * Owner-scoped workspace search. RLS restricts every table to the caller; the
 * explicit owner filter keeps the contract readable and testable.
 */
export async function searchWorkspace(
  rawQuery: unknown,
  options?: { supabase?: SupabaseServerClient; scope?: unknown; ownerUserId?: string },
): Promise<WorkspaceSearchResults> {
  const query = normalizeWorkspaceSearchQuery(rawQuery);
  const scope = normalizeWorkspaceSearchScope(options?.scope);

  if (query.length < WORKSPACE_SEARCH_MIN_QUERY_LENGTH) {
    return emptyResults(query, scope);
  }

  const supabase = options?.supabase ?? (await createClient());
  const pattern = `%${escapePostgrestPattern(query)}%`;
  const wants = (kind: WorkspaceSearchScope) => scope === "all" || scope === kind;

  // Search is an active-workspace surface: archived work is found through the
  // archive centre, and a task whose project/goal is archived is not active
  // even when the task itself was never archived.
  const ancestorScope =
    wants("tasks") || wants("goals")
      ? await loadArchivedAncestorScope(supabase)
      : { ok: true as const, value: { projectIds: [], goalIds: [] } };
  if (!ancestorScope.ok) {
    throw new Error("Failed to load the active search scope.");
  }

  const [tasksResult, projectsResult, goalsResult, ideasResult] = await Promise.all([
    wants("tasks")
      ? excludeArchivedAncestry(
          supabase
            .from("tasks")
            .select("id, title, status, projects(name)")
            .is("archived_at", null),
          ancestorScope.value,
        )
          .ilike("title", pattern)
          .order("updated_at", { ascending: false })
          .limit(TASK_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    wants("projects")
      ? supabase
          .from("projects")
          .select("id, name, slug")
          .is("archived_at", null)
          .ilike("name", pattern)
          .order("updated_at", { ascending: false })
          .limit(PROJECT_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    wants("goals")
      ? (() => {
          let goalsQuery = supabase
            .from("goals")
            .select("id, title")
            .is("archived_at", null);

          // A goal inside an archived project is not active work either.
          if (ancestorScope.value.projectIds.length > 0) {
            goalsQuery = goalsQuery.not(
              "project_id",
              "in",
              `(${ancestorScope.value.projectIds.join(",")})`,
            );
          }

          return goalsQuery
            .ilike("title", pattern)
            .order("created_at", { ascending: false })
            .limit(GOAL_LIMIT);
        })()
      : Promise.resolve({ data: [], error: null }),
    wants("ideas")
      ? supabase
          .from("idea_notes")
          .select("id, title, status")
          .ilike("title", pattern)
          .order("updated_at", { ascending: false })
          .limit(IDEA_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (tasksResult.error) {
    throw new Error(`Failed to search tasks: ${tasksResult.error.message}`);
  }

  if (projectsResult.error) {
    throw new Error(`Failed to search projects: ${projectsResult.error.message}`);
  }

  if (goalsResult.error) {
    throw new Error(`Failed to search goals: ${goalsResult.error.message}`);
  }

  if (ideasResult.error) {
    throw new Error(`Failed to search ideas: ${ideasResult.error.message}`);
  }

  return {
    query,
    scope,
    tasks: (tasksResult.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      projectName: row.projects?.name ?? null,
    })),
    projects: (projectsResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug ?? null,
    })),
    goals: (goalsResult.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
    })),
    ideas: (ideasResult.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
    })),
  };
}
