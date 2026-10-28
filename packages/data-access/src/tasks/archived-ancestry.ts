import type { RepositoryResult } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Active visibility through parent ancestry.
 *
 * A task that is not archived itself is still not "active work" while its
 * project or goal is archived: the parent is out of the active workspace, so
 * its children must not leak into active lists, Today, search or pickers.
 * Archived children keep their own `archived_at`; restoring a parent never
 * touches them, so an independently archived child stays archived.
 *
 * The policy lives here once and is applied by every active task read path.
 * Archived-parent ids are read from the request-scoped client, so ownership
 * (RLS + the explicit owner filter) already bounds the scope.
 */
export type ArchivedAncestorScope = {
  projectIds: string[];
  goalIds: string[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asIds(value: unknown): string[] {
  return ((value ?? []) as Array<{ id?: unknown }>)
    .map((row) => String(row.id ?? ""))
    .filter((id) => UUID_PATTERN.test(id));
}

export async function loadArchivedAncestorScope(
  supabase: SupabaseClient,
  ownerUserId?: string,
): Promise<RepositoryResult<ArchivedAncestorScope>> {
  let projectsQuery = supabase.from("projects").select("id");
  let goalsQuery = supabase.from("goals").select("id");

  // Owner filtering is explicit when the caller has a trusted actor id and
  // left to RLS on legacy compatibility reads that never pass one.
  if (ownerUserId) {
    projectsQuery = projectsQuery.eq("owner_user_id", ownerUserId);
    goalsQuery = goalsQuery.eq("owner_user_id", ownerUserId);
  }

  const [projects, goals] = await Promise.all([
    projectsQuery.not("archived_at", "is", null),
    goalsQuery.not("archived_at", "is", null),
  ]);

  if (projects.error || goals.error) {
    return { ok: false, error: { code: "unknown" } };
  }

  return {
    ok: true,
    value: {
      projectIds: asIds(projects.data),
      goalIds: asIds(goals.data),
    },
  };
}

/**
 * Minimal PostgREST builder surface needed to add the ancestry predicate.
 * Supabase's builders satisfy this structurally.
 */
export type AncestryFilterableQuery<Query> = {
  not(column: string, operator: "in", value: string): Query;
  or(filters: string): Query;
};

/**
 * Exclude tasks whose project or goal is archived. Project ancestry is a
 * plain NOT IN (the column is NOT NULL). Goal ancestry must keep goal-less
 * tasks, and `NOT IN` would drop NULL goal ids, so it is expressed as
 * "no goal OR goal not archived".
 */
export function excludeArchivedAncestry<Query extends AncestryFilterableQuery<Query>>(
  request: Query,
  scope: ArchivedAncestorScope,
): Query {
  let next = request;

  if (scope.projectIds.length > 0) {
    next = next.not("project_id", "in", `(${scope.projectIds.join(",")})`);
  }

  if (scope.goalIds.length > 0) {
    next = next.or(`goal_id.is.null,goal_id.not.in.(${scope.goalIds.join(",")})`);
  }

  return next;
}
