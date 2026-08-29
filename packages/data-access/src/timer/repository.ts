import type {
  AuthenticatedActor,
  RepositoryResult,
  TimerSessionRecord,
  TimerSessionRepository,
  StartableTask,
} from "@ega/application";
import { isTaskCanceledStatus, isTaskCompletedStatus } from "@ega/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isSupabaseUniqueConstraintViolation,
  mcpOperationIdentity,
  sanitizeSupabaseError,
} from "../supabase/errors";

type Row = Record<string, unknown>;

const SESSION_SELECT = "id, task_id, started_at, ended_at, duration_seconds, tasks(title)";

function asRow(value: unknown): Row {
  return (value ?? {}) as Row;
}

function mapSession(row: Row): TimerSessionRecord {
  const tasks = row.tasks as { title?: string | null } | null | undefined;
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    startedAt: String(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? null : String(row.ended_at),
    durationSeconds: typeof row.duration_seconds === "number" ? row.duration_seconds : null,
    taskTitle: tasks?.title ?? null,
  };
}

export class SupabaseTimerSessionRepository implements TimerSessionRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listOpenSessions(actor: AuthenticatedActor): Promise<RepositoryResult<TimerSessionRecord[]>> {
    const result = await this.supabase
      .from("task_sessions")
      .select(SESSION_SELECT)
      .eq("owner_user_id", actor.userId)
      .is("ended_at", null)
      .order("started_at", { ascending: false });

    if (result.error) return { ok: false, error: sanitizeSupabaseError(result.error) };
    return { ok: true, value: ((result.data ?? []) as Row[]).map(mapSession) };
  }

  async listRecentSessions(
    actor: AuthenticatedActor,
    input: Readonly<{ limit: number }>,
  ): Promise<RepositoryResult<TimerSessionRecord[]>> {
    const result = await this.supabase
      .from("task_sessions")
      .select(SESSION_SELECT)
      .eq("owner_user_id", actor.userId)
      .order("started_at", { ascending: false })
      .limit(input.limit);

    if (result.error) return { ok: false, error: sanitizeSupabaseError(result.error) };
    return { ok: true, value: ((result.data ?? []) as Row[]).map(mapSession) };
  }

  async getStartableTask(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string }>,
  ): Promise<RepositoryResult<StartableTask | null>> {
    const result = await this.supabase
      .from("tasks")
      .select("id, title, status, archived_at")
      .eq("id", input.taskId)
      .eq("owner_user_id", actor.userId)
      .maybeSingle();

    if (result.error) return { ok: false, error: sanitizeSupabaseError(result.error) };
    if (!result.data) return { ok: true, value: null };

    const row = asRow(result.data);
    const status = String(row.status ?? "");
    const title = row.title === null || row.title === undefined ? null : String(row.title);

    if (row.archived_at) {
      return { ok: true, value: { eligible: false, reason: "This task is archived.", taskTitle: title } };
    }
    if (isTaskCompletedStatus(status)) {
      return { ok: true, value: { eligible: false, reason: "Completed tasks cannot start a timer.", taskTitle: title } };
    }
    if (isTaskCanceledStatus(status)) {
      return { ok: true, value: { eligible: false, reason: "Canceled tasks cannot start a timer.", taskTitle: title } };
    }

    return { ok: true, value: { eligible: true, reason: null, taskTitle: title } };
  }

  async findSessionByOperation(
    actor: AuthenticatedActor,
    input: Readonly<{ mcpOperationId: string; mcpClientId: string }>,
  ): Promise<RepositoryResult<TimerSessionRecord | null>> {
    const result = await this.supabase
      .from("task_sessions")
      .select(SESSION_SELECT)
      .eq("owner_user_id", actor.userId)
      .eq("mcp_client_id", input.mcpClientId)
      .eq("mcp_operation_id", input.mcpOperationId)
      .maybeSingle();

    if (result.error) return { ok: false, error: sanitizeSupabaseError(result.error) };
    return { ok: true, value: result.data ? mapSession(asRow(result.data)) : null };
  }

  async insertOpenSession(
    actor: AuthenticatedActor,
    input: Readonly<{
      taskId: string;
      startedAtIso: string;
      mcpOperationId?: string;
      mcpClientId?: string;
    }>,
  ): Promise<RepositoryResult<TimerSessionRecord>> {
    const identity = mcpOperationIdentity(input);
    const result = await this.supabase
      .from("task_sessions")
      .insert({
        owner_user_id: actor.userId,
        task_id: input.taskId,
        started_at: input.startedAtIso,
        ...(identity
          ? {
              mcp_operation_id: identity.mcpOperationId,
              mcp_client_id: identity.mcpClientId,
            }
          : {}),
      })
      .select(SESSION_SELECT)
      .single();

    if (result.error || !result.data) {
      const domainCollision =
        identity && isSupabaseUniqueConstraintViolation(result.error, "task_sessions_mcp_operation_unique");
      const openCollision =
        identity && isSupabaseUniqueConstraintViolation(result.error, "task_sessions_owner_open_unique");

      if (identity && (domainCollision || openCollision)) {
        const replay = await this.supabase
          .from("task_sessions")
          .select(SESSION_SELECT)
          .eq("owner_user_id", actor.userId)
          .eq("mcp_client_id", identity.mcpClientId)
          .eq("mcp_operation_id", identity.mcpOperationId)
          .maybeSingle();

        if (replay.error) return { ok: false, error: sanitizeSupabaseError(replay.error) };
        if (replay.data) return { ok: true, value: mapSession(asRow(replay.data)) };

        // A concurrent different operation can collide with the open-session
        // invariant. Without an exact operation row, it is still a real
        // already-running conflict, never a replay.
        if (domainCollision) return { ok: false, error: sanitizeSupabaseError(result.error) };
      }

      // A concurrent start by the same owner loses the race against the
      // partial unique index task_sessions_owner_open_unique; PostgREST
      // surfaces it as SQLSTATE 23505 (some versions only carry the
      // constraint name), so map it to the typed conflict failure.
      return {
        ok: false,
        error: sanitizeSupabaseError(result.error, {
          conflictMessageHint: "task_sessions_owner_open_unique",
        }),
      };
    }
    return { ok: true, value: mapSession(asRow(result.data)) };
  }

  async finalizeOpenSession(
    actor: AuthenticatedActor,
    input: Readonly<{ sessionId: string; endedAtIso: string; durationSeconds: number }>,
  ): Promise<RepositoryResult<boolean>> {
    const result = await this.supabase
      .from("task_sessions")
      .update({
        ended_at: input.endedAtIso,
        duration_seconds: input.durationSeconds,
        updated_at: input.endedAtIso,
      })
      .eq("id", input.sessionId)
      .eq("owner_user_id", actor.userId)
      .is("ended_at", null)
      .select("id");

    if (result.error) return { ok: false, error: sanitizeSupabaseError(result.error) };
    return { ok: true, value: ((result.data ?? []) as unknown[]).length > 0 };
  }
}
