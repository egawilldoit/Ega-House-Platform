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

type AncestorTable = "projects" | "goals";

type AncestorQueryError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
} | null;

function asIds(value: unknown): string[] {
  return ((value ?? []) as Array<{ id?: unknown }>)
    .map((row) => String(row.id ?? ""))
    .filter((id) => UUID_PATTERN.test(id));
}

/**
 * Detect the pre-archive-centre schema, where projects/goals carried archival
 * only as `status = 'archived'` and `archived_at` did not exist yet.
 */
function isMissingArchivedAtColumn(error: AncestorQueryError, table: AncestorTable) {
  if (!error) return false;

  const diagnostic = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!diagnostic.includes("archived_at")) {
    return false;
  }

  if (error.code === "42703" || error.code === "PGRST204") {
    return true;
  }

  return (
    diagnostic.includes(table) &&
    (diagnostic.includes("does not exist") ||
      diagnostic.includes("could not find the") ||
      diagnostic.includes("schema cache"))
  );
}

async function loadArchivedIds(
  supabase: SupabaseClient,
  table: AncestorTable,
  ownerUserId?: string,
): Promise<{ ids: string[]; error: AncestorQueryError }> {
  const read = async (filter: "archived_at" | "status") => {
    let query = supabase.from(table).select("id");

    // Owner filtering is explicit when the caller has a trusted actor id and
    // left to RLS on legacy compatibility reads that never pass one.
    if (ownerUserId) {
      query = query.eq("owner_user_id", ownerUserId);
    }

    const result =
      filter === "archived_at"
        ? await query.not("archived_at", "is", null)
        : await query.eq("status", "archived");

    return result as unknown as { data: unknown; error: AncestorQueryError };
  };

  const modern = await read("archived_at");
  if (!modern.error) {
    return { ids: asIds(modern.data), error: null };
  }

  if (!isMissingArchivedAtColumn(modern.error, table)) {
    return { ids: [], error: modern.error };
  }

  // Migration 0073 makes `status = 'archived'` and `archived_at` equivalent,
  // so the lifecycle marker is the correct pre-migration source of truth.
  const legacy = await read("status");
  return {
    ids: legacy.error ? [] : asIds(legacy.data),
    error: legacy.error,
  };
}

export async function loadArchivedAncestorScope(
  supabase: SupabaseClient,
  ownerUserId?: string,
): Promise<RepositoryResult<ArchivedAncestorScope>> {
  const [projects, goals] = await Promise.all([
    loadArchivedIds(supabase, "projects", ownerUserId),
    loadArchivedIds(supabase, "goals", ownerUserId),
  ]);

  if (projects.error || goals.error) {
    return { ok: false, error: { code: "unknown" } };
  }

  return {
    ok: true,
    value: {
      projectIds: projects.ids,
      goalIds: goals.ids,
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
