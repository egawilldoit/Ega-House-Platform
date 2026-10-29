import type {
  ArchiveGoalRecord,
  ArchiveListQuery,
  ArchiveProjectRecord,
  ArchiveRepository,
  ArchiveSummary,
  ArchiveTaskRecord,
  AuthenticatedActor,
  RepositoryResult,
} from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

/**
 * Archived-only select shapes. Projects and goals expose `archived_at` as the
 * canonical timestamp (added by migration 0073 and kept equal to
 * `status = 'archived'` by a CHECK constraint); tasks already owned it.
 */
const TASK_ARCHIVE_SELECT = [
  "id",
  "title",
  "status",
  "priority",
  "project_id",
  "goal_id",
  "archived_at",
  "updated_at",
  "projects(name, slug, archived_at)",
  "goals(title, archived_at)",
].join(",");

const GOAL_ARCHIVE_SELECT = [
  "id",
  "title",
  "status",
  "project_id",
  "archived_at",
  "updated_at",
  "projects(name, archived_at)",
].join(",");

const PROJECT_ARCHIVE_SELECT = "id, name, slug, archived_at, updated_at";

type Row = Record<string, unknown>;

function asRows(value: unknown): Row[] {
  return (value ?? []) as Row[];
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function asRequiredString(value: unknown): string | null {
  const text = asNullableString(value);
  return text && text.trim() ? text : null;
}

/** Escape PostgREST `ilike` wildcards so a search is a literal substring. */
function archiveSearchPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function mapTaskRow(row: Row): ArchiveTaskRecord | null {
  const archivedAt = asRequiredString(row.archived_at);
  if (!archivedAt) return null;
  const project = row.projects as
    | { name?: unknown; slug?: unknown; archived_at?: unknown }
    | null
    | undefined;
  const goal = row.goals as { title?: unknown; archived_at?: unknown } | null | undefined;

  return {
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    priority: String(row.priority),
    projectId: String(row.project_id),
    projectName: asNullableString(project?.name),
    projectSlug: asNullableString(project?.slug),
    projectArchived: Boolean(asNullableString(project?.archived_at)),
    goalId: asNullableString(row.goal_id),
    goalTitle: asNullableString(goal?.title),
    goalArchived: Boolean(asNullableString(goal?.archived_at)),
    archivedAt,
    updatedAt: String(row.updated_at),
  };
}

function mapGoalRow(row: Row): ArchiveGoalRecord | null {
  const archivedAt = asRequiredString(row.archived_at);
  if (!archivedAt) return null;
  const project = row.projects as { name?: unknown; archived_at?: unknown } | null | undefined;

  return {
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    projectId: String(row.project_id),
    projectName: asNullableString(project?.name),
    projectArchived: Boolean(asNullableString(project?.archived_at)),
    archivedAt,
    updatedAt: String(row.updated_at),
  };
}

function mapProjectRow(row: Row): ArchiveProjectRecord | null {
  const archivedAt = asRequiredString(row.archived_at);
  if (!archivedAt) return null;

  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    archivedAt,
    updatedAt: String(row.updated_at),
  };
}

/**
 * Supabase-backed archive centre reads.
 *
 * Every query is scoped by the trusted actor's `owner_user_id` and relies on
 * the request-scoped client so RLS agrees rather than being replaced. Rows
 * without an archival timestamp are never returned: the archive centre lists
 * evidence of archiving, not a status guess.
 */
export class SupabaseArchiveRepository implements ArchiveRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getArchiveSummary(actor: AuthenticatedActor): Promise<RepositoryResult<ArchiveSummary>> {
    const [tasks, goals, projects] = await Promise.all([
      this.countArchived("tasks", actor),
      this.countArchived("goals", actor),
      this.countArchived("projects", actor),
    ]);

    if (!tasks.ok || !goals.ok || !projects.ok) {
      return { ok: false, error: { code: "unknown" } };
    }

    return {
      ok: true,
      value: {
        tasks: tasks.value,
        goals: goals.value,
        projects: projects.value,
      },
    };
  }

  async listArchivedTasks(
    actor: AuthenticatedActor,
    query: ArchiveListQuery,
  ): Promise<RepositoryResult<ArchiveTaskRecord[]>> {
    let request = this.supabase
      .from("tasks")
      .select(TASK_ARCHIVE_SELECT)
      .eq("owner_user_id", actor.userId)
      .not("archived_at", "is", null);

    if (query.search) {
      request = request.ilike("title", archiveSearchPattern(query.search));
    }

    const { data, error } = await request
      .order("archived_at", { ascending: false })
      .limit(query.limit);

    if (error) return { ok: false, error: sanitizeSupabaseError(error) };

    return {
      ok: true,
      value: asRows(data)
        .map(mapTaskRow)
        .filter((row): row is ArchiveTaskRecord => row !== null),
    };
  }

  async listArchivedGoals(
    actor: AuthenticatedActor,
    query: ArchiveListQuery,
  ): Promise<RepositoryResult<ArchiveGoalRecord[]>> {
    let request = this.supabase
      .from("goals")
      .select(GOAL_ARCHIVE_SELECT)
      .eq("owner_user_id", actor.userId)
      .not("archived_at", "is", null);

    if (query.search) {
      request = request.ilike("title", archiveSearchPattern(query.search));
    }

    const { data, error } = await request
      .order("archived_at", { ascending: false })
      .limit(query.limit);

    if (error) return { ok: false, error: sanitizeSupabaseError(error) };

    return {
      ok: true,
      value: asRows(data)
        .map(mapGoalRow)
        .filter((row): row is ArchiveGoalRecord => row !== null),
    };
  }

  async listArchivedProjects(
    actor: AuthenticatedActor,
    query: ArchiveListQuery,
  ): Promise<RepositoryResult<ArchiveProjectRecord[]>> {
    let request = this.supabase
      .from("projects")
      .select(PROJECT_ARCHIVE_SELECT)
      .eq("owner_user_id", actor.userId)
      .not("archived_at", "is", null);

    if (query.search) {
      request = request.ilike("name", archiveSearchPattern(query.search));
    }

    const { data, error } = await request
      .order("archived_at", { ascending: false })
      .limit(query.limit);

    if (error) return { ok: false, error: sanitizeSupabaseError(error) };

    return {
      ok: true,
      value: asRows(data)
        .map(mapProjectRow)
        .filter((row): row is ArchiveProjectRecord => row !== null),
    };
  }

  private async countArchived(
    table: "tasks" | "goals" | "projects",
    actor: AuthenticatedActor,
  ): Promise<RepositoryResult<number>> {
    const { count, error } = await this.supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", actor.userId)
      .not("archived_at", "is", null);

    if (error) return { ok: false, error: sanitizeSupabaseError(error) };
    return { ok: true, value: count ?? 0 };
  }
}
