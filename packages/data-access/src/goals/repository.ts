import {
  type AuthenticatedActor,
  type CreateGoalRecordInput,
  type GoalHealth,
  type GoalRecord,
  type GoalStatus,
  type GoalTaskContextRecord,
  type GoalsRepository,
  type GoalViewFilter,
  type RepositoryResult,
} from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

const GOAL_SELECT =
  "id, project_id, title, slug, description, next_step, health, status, created_at, updated_at";

type GoalRow = {
  id: string;
  project_id: string;
  title: string;
  slug: string | null;
  description: string | null;
  next_step: string | null;
  health: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type GoalStatusRow = { status: string | null };

type GoalTaskRow = {
  id: string;
  title: string;
  status: string;
  goal_id: string | null;
};

type ProjectOptionRow = {
  id: string;
  name: string;
};

function mapGoalRow(row: GoalRow): GoalRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    nextStep: row.next_step,
    health: row.health,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Supabase-backed implementation of the goal repository ports.
 *
 * Uses the request-scoped Supabase client supplied by the web adapter and
 * preserves Supabase RLS. Every read/write is additionally scoped by the
 * trusted actor's `owner_user_id` as defense in depth — this agrees with RLS
 * rather than replacing it.
 */
export class SupabaseGoalsRepository implements GoalsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listProjectOptions(
    actor: AuthenticatedActor,
  ): Promise<RepositoryResult<{ id: string; name: string }[]>> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("id, name")
      .eq("owner_user_id", actor.userId)
      .order("name", { ascending: true });

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return { ok: true, value: (data ?? []).map((row: ProjectOptionRow) => row) };
  }

  async listGoals(
    actor: AuthenticatedActor,
    view: GoalViewFilter,
  ): Promise<RepositoryResult<GoalRecord[]>> {
    let query = this.supabase
      .from("goals")
      .select(GOAL_SELECT)
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

    return { ok: true, value: (data ?? []).map(mapGoalRow) };
  }

  async listGoalTasks(actor: AuthenticatedActor): Promise<RepositoryResult<GoalTaskContextRecord[]>> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("id, title, status, goal_id")
      .not("goal_id", "is", null)
      .eq("owner_user_id", actor.userId)
      .order("updated_at", { ascending: false });

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return {
      ok: true,
      value: (data ?? [])
        .filter((row: GoalTaskRow) => row.goal_id !== null)
        .map((row: GoalTaskRow) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          goalId: row.goal_id as string,
        })),
    };
  }

  async listGoalStatuses(actor: AuthenticatedActor): Promise<RepositoryResult<string[]>> {
    const { data, error } = await this.supabase
      .from("goals")
      .select("status")
      .eq("owner_user_id", actor.userId);

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return {
      ok: true,
      value: (data ?? []).map((row: GoalStatusRow) => row.status ?? ""),
    };
  }

  async createGoal(
    actor: AuthenticatedActor,
    input: CreateGoalRecordInput,
  ): Promise<RepositoryResult<null>> {
    const { error } = await this.supabase.from("goals").insert({
      title: input.title,
      project_id: input.projectId,
      description: input.description,
      next_step: input.nextStep,
      health: input.health,
      status: input.status,
      slug: input.slug,
      owner_user_id: actor.userId,
    });

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return { ok: true, value: null };
  }

  async updateGoalStatus(
    actor: AuthenticatedActor,
    input: { goalId: string; status: GoalStatus | "archived"; updatedAt: string },
  ): Promise<RepositoryResult<null>> {
    const { error } = await this.supabase
      .from("goals")
      .update({
        status: input.status,
        updated_at: input.updatedAt,
      })
      .eq("id", input.goalId)
      .eq("owner_user_id", actor.userId);

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return { ok: true, value: null };
  }

  async updateGoalHealth(
    actor: AuthenticatedActor,
    input: { goalId: string; health: GoalHealth | null; updatedAt: string },
  ): Promise<RepositoryResult<null>> {
    const { error } = await this.supabase
      .from("goals")
      .update({
        health: input.health,
        updated_at: input.updatedAt,
      })
      .eq("id", input.goalId)
      .eq("owner_user_id", actor.userId);

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return { ok: true, value: null };
  }

  async updateGoalNextStep(
    actor: AuthenticatedActor,
    input: { goalId: string; nextStep: string | null; updatedAt: string },
  ): Promise<RepositoryResult<null>> {
    const { error } = await this.supabase
      .from("goals")
      .update({
        next_step: input.nextStep,
        updated_at: input.updatedAt,
      })
      .eq("id", input.goalId)
      .eq("owner_user_id", actor.userId);

    if (error) {
      return { ok: false, error: sanitizeSupabaseError(error) };
    }

    return { ok: true, value: null };
  }
}
