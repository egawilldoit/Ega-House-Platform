import { createClient } from "@/lib/supabase/server";
import {
  WORKSPACE_SEARCH_MAX_QUERY_LENGTH,
  WORKSPACE_SEARCH_MIN_QUERY_LENGTH,
} from "@/lib/workspace-search";

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

export type WorkspaceSearchResults = {
  query: string;
  tasks: WorkspaceSearchTaskHit[];
  projects: WorkspaceSearchProjectHit[];
  goals: WorkspaceSearchGoalHit[];
};

const TASK_LIMIT = 6;
const PROJECT_LIMIT = 4;
const GOAL_LIMIT = 4;

function escapePostgrestPattern(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function normalizeWorkspaceSearchQuery(rawQuery: unknown): string {
  return String(rawQuery ?? "").trim().slice(0, WORKSPACE_SEARCH_MAX_QUERY_LENGTH);
}

function emptyResults(query: string): WorkspaceSearchResults {
  return { query, tasks: [], projects: [], goals: [] };
}

export async function searchWorkspace(
  rawQuery: unknown,
  options?: { supabase?: SupabaseServerClient },
): Promise<WorkspaceSearchResults> {
  const query = normalizeWorkspaceSearchQuery(rawQuery);

  if (query.length < WORKSPACE_SEARCH_MIN_QUERY_LENGTH) {
    return emptyResults(query);
  }

  const supabase = options?.supabase ?? (await createClient());
  const pattern = `%${escapePostgrestPattern(query)}%`;

  const [tasksResult, projectsResult, goalsResult] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, status, projects(name)")
      .ilike("title", pattern)
      .order("updated_at", { ascending: false })
      .limit(TASK_LIMIT),
    supabase
      .from("projects")
      .select("id, name, slug")
      .ilike("name", pattern)
      .order("updated_at", { ascending: false })
      .limit(PROJECT_LIMIT),
    supabase
      .from("goals")
      .select("id, title")
      .ilike("title", pattern)
      .order("created_at", { ascending: false })
      .limit(GOAL_LIMIT),
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

  return {
    query,
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
  };
}
