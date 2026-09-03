import {
  type AuthenticatedActor,
  type CreateProjectRecordInput,
  type DeleteArchivedProjectInput,
  type DeleteArchivedProjectResult,
  type ProjectGoalRecord,
  type ProjectRecord,
  type ProjectsRepository,
  type ProjectTaskContextRecord,
  type RepositoryResult,
  type ProjectViewFilter,
  type ProjectStatus,
} from "@ega/application";
import { PROJECT_ARCHIVE_STATUS } from "@ega/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isSupabaseForeignKeyViolation,
  isSupabaseUniqueConstraintViolation,
  mcpOperationIdentity,
  sanitizeSupabaseError,
} from "../supabase/errors";

const PROJECT_SELECT = "id, name, slug, description, status, created_at, updated_at";

type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type ProjectStatusRow = { status: string | null };

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  priority: string;
  updated_at: string;
};

type GoalRow = {
  id: string;
  title: string;
  project_id: string;
};

function mapProjectRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTaskRow(row: TaskRow): ProjectTaskContextRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    updatedAt: row.updated_at,
  };
}

/**
 * Supabase-backed implementation of the project repository ports.
 *
 * Uses the request-scoped Supabase client supplied by the web adapter and
 * preserves Supabase RLS. Every read/write is additionally scoped by the
 * trusted actor's `owner_user_id` as defense in depth — this agrees with RLS
 * rather than replacing it.
 */
export class SupabaseProjectsRepository implements ProjectsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listProjects(
    actor: AuthenticatedActor,
    view: ProjectViewFilter,
  ): Promise<RepositoryResult<ProjectRecord[]>> {
    let query = this.supabase
      .from("projects")
      .select(PROJECT_SELECT)
      .eq("owner_user_id", actor.userId)
      .order("updated_at", { ascending: false });

    if (view === "active") {
      query = query.neq("status", "archived");
    } else if (view === "archived") {
      query = query.eq("status", "archived");
    }

    const { data, error } = await query;

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return { ok: true, value: (data ?? []).map(mapProjectRow) };
  }

  async listProjectStatuses(actor: AuthenticatedActor): Promise<RepositoryResult<string[]>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("status")
      .eq("owner_user_id", actor.userId);

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return {
      ok: true,
      value: (data ?? []).map((row: ProjectStatusRow) => row.status ?? ""),
    };
  }

  async listTasksForProjects(
    actor: AuthenticatedActor,
    projectIds: string[],
  ): Promise<RepositoryResult<ProjectTaskContextRecord[]>> {
    if (projectIds.length === 0) {
      return { ok: true, value: [] };
    }

    const { data, error } = await this.supabase
      .from("tasks")
      .select("id, project_id, title, status, priority, updated_at")
      .in("project_id", projectIds)
      .eq("owner_user_id", actor.userId)
      .order("updated_at", { ascending: false });

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return { ok: true, value: (data ?? []).map(mapTaskRow) };
  }

  async getProjectBySlug(
    actor: AuthenticatedActor,
    slug: string,
  ): Promise<RepositoryResult<ProjectRecord | null>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select(PROJECT_SELECT)
      .eq("slug", slug)
      .eq("owner_user_id", actor.userId)
      .maybeSingle();

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return { ok: true, value: data ? mapProjectRow(data as ProjectRow) : null };
  }

  async getProjectById(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<RepositoryResult<ProjectRecord | null>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select(PROJECT_SELECT)
      .eq("id", projectId)
      .eq("owner_user_id", actor.userId)
      .maybeSingle();

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return { ok: true, value: data ? mapProjectRow(data as ProjectRow) : null };
  }

  async listGoalsForProject(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<RepositoryResult<ProjectGoalRecord[]>> {
    const { data, error } = await this.supabase
      .from("goals")
      .select("id, title, project_id")
      .eq("project_id", projectId)
      .eq("owner_user_id", actor.userId)
      .order("created_at", { ascending: false });

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return {
      ok: true,
      value: (data ?? []).map((row: GoalRow) => ({
        id: row.id,
        title: row.title,
        projectId: row.project_id,
      })),
    };
  }

  async createProject(
    actor: AuthenticatedActor,
    input: CreateProjectRecordInput,
  ): Promise<RepositoryResult<null>> {
    const identity = mcpOperationIdentity(input);
    const { error } = await this.supabase.from("projects").insert({
      name: input.name,
      slug: input.slug,
      description: input.description,
      owner_user_id: actor.userId,
      ...(identity
        ? {
            mcp_operation_id: identity.mcpOperationId,
            mcp_client_id: identity.mcpClientId,
          }
        : {}),
    });

    if (error) {
      // PostgreSQL may report the owner+slug unique index before the 0059
      // operation index when a crashed retry repeats identical project args.
      // Only a collision followed by an exact owner/client/operation lookup
      // is a replay; a different project's slug conflict remains a failure.
      const operationCollision = identity && isSupabaseUniqueConstraintViolation(
        error,
        "projects_mcp_operation_unique",
      );
      const slugCollision = identity && isSupabaseUniqueConstraintViolation(
        error,
        "projects_owner_user_id_slug_unique",
      );
      if (identity && (operationCollision || slugCollision)) {
        const replay = await this.supabase
          .from("projects")
          .select("id")
          .eq("owner_user_id", actor.userId)
          .eq("mcp_client_id", identity.mcpClientId)
          .eq("mcp_operation_id", identity.mcpOperationId)
          .maybeSingle();
        if (replay.error) return { ok: false, error: sanitizeSupabaseError(replay.error) };
        if (replay.data) return { ok: true, value: null };
      }
      return {
        ok: false,
        error: sanitizeSupabaseError(error, {
          conflictMessageHint: "projects_owner_user_id_slug_unique",
        }),
      };
    }

    return { ok: true, value: null };
  }

  async updateProjectStatus(
    actor: AuthenticatedActor,
    input: { projectId: string; status: ProjectStatus; updatedAt: string },
  ): Promise<RepositoryResult<null>> {
    const { error } = await this.supabase
      .from("projects")
      .update({
        status: input.status,
        updated_at: input.updatedAt,
      })
      .eq("id", input.projectId)
      .eq("owner_user_id", actor.userId);

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return { ok: true, value: null };
  }

  /**
   * Permanently delete one project row. Defense in depth: the write is scoped
   * to the owner and to the archived status, so a non-archived or foreign row
   * can never match even if a caller bypasses the application pre-check. A
   * foreign-key refusal (linked task/goal inserted after the pre-check)
   * becomes a conflict; `deleted: false` covers the zero-row race.
   */
  async deleteArchivedProject(
    actor: AuthenticatedActor,
    input: DeleteArchivedProjectInput,
  ): Promise<RepositoryResult<DeleteArchivedProjectResult>> {
    const { data, error } = await this.supabase
      .from("projects")
      .delete()
      .eq("id", input.projectId)
      .eq("owner_user_id", actor.userId)
      .eq("status", PROJECT_ARCHIVE_STATUS)
      .select("id");

    if (error) {
      if (isSupabaseForeignKeyViolation(error)) {
        return { ok: false, error: { code: "conflict" } };
      }

      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return { ok: true, value: { deleted: (data ?? []).length > 0 } };
  }
}
