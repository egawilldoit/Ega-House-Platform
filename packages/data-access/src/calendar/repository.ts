import type {
  CalendarConnectionRecord,
  CalendarEventIndexEntry,
  CalendarJobRecord,
  CalendarMappingRecord,
  CalendarReadyQueue,
  CalendarRunCounts,
  CalendarRunExclusionCount,
  CalendarRunFailure,
  CalendarRunItemDraft,
  CalendarRunRecord,
  CalendarScanCommit,
  CalendarScanCursor,
  CalendarScanJobDraft,
  CalendarSyncDestination,
  CalendarSyncItemOutcome,
  CalendarSyncRepository,
  CalendarTaskPage,
  CalendarTaskScanRecord,
  RefreshedCalendarCredentials,
} from "@ega/application/calendar-sync/ports";
import type { AuthenticatedActor } from "@ega/application/auth/actor";
import type { RepositoryResult } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

type Row = Record<string, unknown>;

export type SupabaseCalendarSyncScope = "owner" | "service";

function asRow(value: unknown): Row {
  return (value ?? {}) as Row;
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function failure<T>(error: unknown): RepositoryResult<T> {
  return {
    ok: false,
    error: sanitizeSupabaseError(error as { code?: string; message?: string } | null),
  };
}

function destinationFromRow(row: Row): CalendarSyncDestination {
  return {
    accountSubject: nullableString(row.google_account_subject),
    accountEmail: nullableString(row.google_account_email),
    calendarId: nullableString(row.calendar_id) ?? "primary",
    destinationKey: String(row.destination_key ?? ""),
  };
}

function mapConnection(row: Row): CalendarConnectionRecord {
  return {
    ownerUserId: String(row.owner_user_id),
    provider: "google",
    accountSubject: nullableString(row.google_account_subject),
    accountEmail: nullableString(row.google_account_email),
    calendarId: nullableString(row.calendar_id) ?? "primary",
    destinationKey: "",
    accessTokenEncrypted: nullableString(row.access_token_encrypted),
    refreshTokenEncrypted: nullableString(row.refresh_token_encrypted),
    tokenExpiresAt: nullableString(row.token_expires_at),
    connectedAt: nullableString(row.connected_at),
    disconnectedAt: nullableString(row.disconnected_at),
    reconnectRequiredAt: nullableString(row.reconnect_required_at),
    updatedAt: String(row.updated_at),
  };
}

function mapTask(row: Row): CalendarTaskScanRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    title: String(row.title ?? ""),
    status: String(row.status ?? "todo"),
    archivedAt: nullableString(row.archived_at),
    completedAt: nullableString(row.completed_at),
    calendarSyncEnabled: Boolean(row.calendar_sync_enabled),
    calendarReminderMinutes: Number(row.calendar_reminder_minutes ?? 10),
    scheduledStartAt: nullableString(row.scheduled_start_at),
    scheduledEndAt: nullableString(row.scheduled_end_at),
    plannedForDate: nullableString(row.planned_for_date),
    dueDate: nullableString(row.due_date),
    calendarEventId: nullableString(row.calendar_event_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRun(row: Row): CalendarRunRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    destination: destinationFromRow(row),
    status: String(row.status) as CalendarRunRecord["status"],
    retryMode: Boolean(row.retry_mode),
    scanComplete: Boolean(row.scan_complete),
    scanCursorCreatedAt: nullableString(row.scan_cursor_created_at),
    scanCursorTaskId: nullableString(row.scan_cursor_task_id),
    lastError: nullableString(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: nullableString(row.completed_at),
  };
}

function mapMapping(row: Row): CalendarMappingRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    taskId: String(row.task_id),
    destination: destinationFromRow(row),
    eventId: String(row.event_id),
    generation: Number(row.generation ?? 1),
    status: String(row.status) as "active" | "removed",
    metadataVerified: Boolean(row.metadata_verified),
    payloadHash: nullableString(row.payload_hash),
    lastSyncedAt: nullableString(row.last_synced_at),
    updatedAt: String(row.updated_at),
  };
}

function mapJob(row: Row): CalendarJobRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    taskId: String(row.task_id),
    runId: nullableString(row.run_id),
    destination: destinationFromRow(row),
    operation: String(row.operation) as "upsert" | "delete",
    status: String(row.status) as CalendarJobRecord["status"],
    attempts: Number(row.attempts ?? 0),
    eventId: nullableString(row.calendar_event_id),
    generation: Number(row.generation ?? 1),
    eventExists: Boolean(row.event_exists),
    payloadHash: nullableString(row.payload_hash),
    claimToken: nullableString(row.claim_token),
    permanentFailure: Boolean(row.permanent_failure),
    exclusionReason: nullableString(row.exclusion_reason) as
      | CalendarJobRecord["exclusionReason"],
    lastError: nullableString(row.last_error),
    scheduledAt: String(row.scheduled_at),
    taskUpdatedAt: nullableString(row.task_updated_at),
  };
}

const TASK_COLUMNS =
  "id, owner_user_id, title, status, archived_at, completed_at, calendar_sync_enabled, calendar_reminder_minutes, scheduled_start_at, scheduled_end_at, planned_for_date, due_date, calendar_event_id, created_at, updated_at";

const RUN_COLUMNS =
  "id, owner_user_id, destination_key, google_account_subject, google_account_email, calendar_id, status, retry_mode, scan_cursor_created_at, scan_cursor_task_id, scan_complete, last_error, created_at, updated_at, completed_at";

const MAPPING_COLUMNS =
  "id, owner_user_id, task_id, destination_key, google_account_subject, google_account_email, calendar_id, event_id, generation, status, metadata_verified, payload_hash, last_synced_at, updated_at";

// calendar_sync_commit_scan_page reads snake_case JSON keys from p_items and
// p_jobs. Keep that dialect at the adapter boundary so application drafts stay
// camelCase and a missing key can never become a NULL task_id in SQL.
export function toCalendarScanItemPayload(
  item: CalendarRunItemDraft,
): Record<string, unknown> {
  return {
    task_id: item.taskId,
    outcome: item.outcome,
    exclusion_reason: item.exclusionReason,
    event_id: item.eventId,
    payload_hash: item.payloadHash,
    error_message: item.errorMessage ?? null,
  };
}

export function toCalendarScanJobPayload(
  job: CalendarScanJobDraft,
): Record<string, unknown> {
  return {
    task_id: job.taskId,
    operation: job.operation,
    calendar_event_id: job.eventId,
    generation: job.generation,
    event_exists: job.eventExists,
    payload_hash: job.payloadHash,
    exclusion_reason: job.exclusionReason,
    task_updated_at: job.taskUpdatedAt,
  };
}

export class SupabaseCalendarSyncRepository implements CalendarSyncRepository {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly options: { scope?: SupabaseCalendarSyncScope } = {},
  ) {}

  private get scope() {
    return this.options.scope ?? "owner";
  }

  private ownerScoped<T extends { eq: (column: string, value: string) => T }>(
    query: T,
    actor: AuthenticatedActor,
  ): T {
    return this.scope === "owner" ? query.eq("owner_user_id", actor.userId) : query;
  }

  async getConnection(
    actor: AuthenticatedActor,
  ): Promise<RepositoryResult<CalendarConnectionRecord | null>> {
    let query = this.supabase
      .from("calendar_integration_settings")
      .select("*")
      .eq("provider", "google")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (this.scope === "owner") {
      query = query.eq("owner_user_id", actor.userId);
    }
    const result = await query.maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapConnection(asRow(result.data)) };
  }

  async getConnectionForOwner(
    _actor: AuthenticatedActor,
    ownerUserId: string,
  ): Promise<RepositoryResult<CalendarConnectionRecord | null>> {
    const result = await this.supabase
      .from("calendar_integration_settings")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .eq("provider", "google")
      .maybeSingle();
    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapConnection(asRow(result.data)) };
  }

  async updateConnectionCredentials(
    _actor: AuthenticatedActor,
    input: {
      ownerUserId: string;
      expectedUpdatedAt: string;
      credentials: RefreshedCalendarCredentials;
      nowIso: string;
    },
  ): Promise<RepositoryResult<boolean>> {
    const patch: Record<string, unknown> = {
      access_token_encrypted: input.credentials.accessTokenEncrypted,
      token_expires_at: input.credentials.tokenExpiresAt,
      updated_at: input.nowIso,
    };
    if (input.credentials.refreshTokenEncrypted !== undefined) {
      patch.refresh_token_encrypted = input.credentials.refreshTokenEncrypted;
    }
    const result = await this.supabase
      .from("calendar_integration_settings")
      .update(patch as never)
      .eq("owner_user_id", input.ownerUserId)
      .eq("provider", "google")
      .eq("updated_at", input.expectedUpdatedAt)
      .select("id")
      .maybeSingle();
    if (result.error) return failure(result.error);
    return { ok: true, value: Boolean(result.data) };
  }

  async markReconnectRequired(
    _actor: AuthenticatedActor,
    input: { ownerUserId: string; message: string; nowIso: string },
  ): Promise<RepositoryResult<void>> {
    const result = await this.supabase
      .from("calendar_integration_settings")
      .update({
        reconnect_required_at: input.nowIso,
        reconnect_required_reason: input.message.slice(0, 500),
        updated_at: input.nowIso,
      } as never)
      .eq("owner_user_id", input.ownerUserId)
      .eq("provider", "google");
    if (result.error) return failure(result.error);
    return { ok: true, value: undefined };
  }

  async ensureRun(
    _actor: AuthenticatedActor,
    input: {
      destination: CalendarSyncDestination;
      retryMode: boolean;
      nowIso: string;
    },
  ): Promise<RepositoryResult<CalendarRunRecord>> {
    if (this.scope === "owner") {
      await this.supabase
        .from("calendar_sync_runs")
        .update({ status: "paused", updated_at: input.nowIso } as never)
        .eq("owner_user_id", _actor.userId)
        .eq("status", "active")
        .neq("destination_key", input.destination.destinationKey);
    }

    const latest = await this.supabase
      .from("calendar_sync_runs")
      .select(RUN_COLUMNS)
      .eq("destination_key", input.destination.destinationKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) return failure(latest.error);
    const latestRun = latest.data ? mapRun(asRow(latest.data)) : null;

    if (
      latestRun &&
      (latestRun.status === "active" ||
        latestRun.status === "paused" ||
        (input.retryMode && latestRun.status === "completed"))
    ) {
      const resumed = await this.supabase
        .from("calendar_sync_runs")
        .update({
          status: "active",
          retry_mode: input.retryMode,
          last_error: null,
          updated_at: input.nowIso,
          completed_at: null,
        } as never)
        .eq("id", latestRun.id)
        .select(RUN_COLUMNS)
        .maybeSingle();
      if (resumed.error) return failure(resumed.error);
      const run = resumed.data ? mapRun(asRow(resumed.data)) : latestRun;
      if (input.retryMode) {
        await this.requeueRetryableJobs(_actor, {
          runId: run.id,
          destinationKey: run.destination.destinationKey,
          nowIso: input.nowIso,
        });
      }
      return { ok: true, value: run };
    }

    const inserted = await this.supabase
      .from("calendar_sync_runs")
      .insert({
        destination_key: input.destination.destinationKey,
        google_account_subject: input.destination.accountSubject,
        google_account_email: input.destination.accountEmail,
        calendar_id: input.destination.calendarId,
        status: "active",
        retry_mode: input.retryMode,
        updated_at: input.nowIso,
        created_at: input.nowIso,
      } as never)
      .select(RUN_COLUMNS)
      .maybeSingle();

    if (inserted.error?.code === "23505") {
      const existing = await this.supabase
        .from("calendar_sync_runs")
        .select(RUN_COLUMNS)
        .eq("destination_key", input.destination.destinationKey)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing.error) return failure(existing.error);
      if (existing.data) {
        return { ok: true, value: mapRun(asRow(existing.data)) };
      }
    }

    if (inserted.error) return failure(inserted.error);
    if (!inserted.data) return failure({ message: "Calendar run insert returned no row." });
    return { ok: true, value: mapRun(asRow(inserted.data)) };
  }

  async getRun(
    _actor: AuthenticatedActor,
    runId: string,
  ): Promise<RepositoryResult<CalendarRunRecord | null>> {
    let query = this.supabase
      .from("calendar_sync_runs")
      .select(RUN_COLUMNS)
      .eq("id", runId);
    if (this.scope === "owner") query = query.eq("owner_user_id", _actor.userId);
    const result = await query.maybeSingle();
    if (result.error) return failure(result.error);
    return { ok: true, value: result.data ? mapRun(asRow(result.data)) : null };
  }

  async getLatestRun(
    actor: AuthenticatedActor,
    destinationKey: string,
  ): Promise<RepositoryResult<CalendarRunRecord | null>> {
    let query = this.supabase
      .from("calendar_sync_runs")
      .select(RUN_COLUMNS)
      .eq("destination_key", destinationKey)
      .order("created_at", { ascending: false })
      .limit(1);
    if (this.scope === "owner") query = query.eq("owner_user_id", actor.userId);
    const result = await query.maybeSingle();
    if (result.error) return failure(result.error);
    return { ok: true, value: result.data ? mapRun(asRow(result.data)) : null };
  }

  async getPausedRun(
    actor: AuthenticatedActor,
    destinationKey: string,
  ): Promise<RepositoryResult<CalendarRunRecord | null>> {
    let query = this.supabase
      .from("calendar_sync_runs")
      .select(RUN_COLUMNS)
      .eq("status", "paused")
      .neq("destination_key", destinationKey)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (this.scope === "owner") query = query.eq("owner_user_id", actor.userId);
    const result = await query.maybeSingle();
    if (result.error) return failure(result.error);
    return { ok: true, value: result.data ? mapRun(asRow(result.data)) : null };
  }

  async pauseRun(
    _actor: AuthenticatedActor,
    runId: string,
    message: string,
    nowIso: string,
  ): Promise<RepositoryResult<void>> {
    let query = this.supabase
      .from("calendar_sync_runs")
      .update({
        status: "paused",
        last_error: message.slice(0, 500),
        updated_at: nowIso,
      } as never)
      .eq("id", runId);
    if (this.scope === "owner") query = query.eq("owner_user_id", _actor.userId);
    const result = await query;
    if (result.error) return failure(result.error);
    return { ok: true, value: undefined };
  }

  async requeueRetryableJobs(
    _actor: AuthenticatedActor,
    input: { runId: string; destinationKey: string; nowIso: string },
  ): Promise<RepositoryResult<number>> {
    let query = this.supabase
      .from("calendar_sync_jobs")
      .update({
        status: "pending",
        permanent_failure: false,
        scheduled_at: input.nowIso,
        claim_token: null,
        lease_expires_at: null,
        updated_at: input.nowIso,
      } as never)
      .eq("run_id", input.runId)
      .eq("destination_key", input.destinationKey)
      .eq("queue_version", 2)
      .eq("permanent_failure", false)
      .in("status", ["failed", "pending"])
      .gt("attempts", 0)
      .select("id");
    if (this.scope === "owner") query = query.eq("owner_user_id", _actor.userId);
    const result = await query;
    if (result.error) return failure(result.error);

    const requeuedJobs = asRows(result.data);
    if (requeuedJobs.length > 0) {
      await this.supabase
        .from("calendar_sync_run_items")
        .update({
          outcome: "pending",
          error_message: null,
          updated_at: input.nowIso,
        } as never)
        .eq("run_id", input.runId)
        .in(
          "task_id",
          requeuedJobs.map((job) => String(job.task_id)),
        )
        .eq("outcome", "failed");
    }

    return { ok: true, value: requeuedJobs.length };
  }

  async getRunCounts(
    _actor: AuthenticatedActor,
    runId: string,
  ): Promise<RepositoryResult<CalendarRunCounts>> {
    const result = await this.supabase.rpc("calendar_sync_run_counts", {
      p_run_id: runId,
    });
    if (result.error) return failure(result.error);
    const data = asRow(result.data);
    const count = (key: string) => Number(data[key] ?? 0);
    return {
      ok: true,
      value: {
        total: count("total"),
        created: count("created"),
        updated: count("updated"),
        removed: count("removed"),
        unchanged: count("unchanged"),
        excluded: count("excluded"),
        failed: count("failed"),
        pending: count("pending"),
        retrying: count("retrying"),
        processing: count("processing"),
        ready: count("ready"),
      },
    };
  }

  async listExclusionCounts(
    _actor: AuthenticatedActor,
    runId: string,
  ): Promise<RepositoryResult<CalendarRunExclusionCount[]>> {
    const result = await this.supabase.rpc("calendar_sync_run_exclusions", {
      p_run_id: runId,
    });
    if (result.error) return failure(result.error);
    return {
      ok: true,
      value: asRows(result.data).map((row) => ({
        reason: String(row.reason) as CalendarRunExclusionCount["reason"],
        count: Number(row.count ?? 0),
      })),
    };
  }

  async listRunFailures(
    _actor: AuthenticatedActor,
    runId: string,
    limit: number,
  ): Promise<RepositoryResult<CalendarRunFailure[]>> {
    const result = await this.supabase.rpc("calendar_sync_run_failures", {
      p_run_id: runId,
      p_limit: limit,
    });
    if (result.error) return failure(result.error);
    return {
      ok: true,
      value: asRows(result.data).map((row) => ({
        taskId: String(row.task_id),
        message: String(row.message ?? "Calendar sync failed."),
      })),
    };
  }

  async claimScan(
    _actor: AuthenticatedActor,
    input: {
      runId: string;
      claimToken: string;
      nowIso: string;
      leaseSeconds: number;
    },
  ): Promise<RepositoryResult<boolean>> {
    const result = await this.supabase.rpc("calendar_sync_claim_run_scan", {
      p_run_id: input.runId,
      p_claim_token: input.claimToken,
      p_now: input.nowIso,
      p_lease_seconds: input.leaseSeconds,
    });
    if (result.error) return failure(result.error);
    return { ok: true, value: Boolean(result.data) };
  }

  async loadTaskPage(
    _actor: AuthenticatedActor,
    input: {
      ownerUserId: string;
      cursor: CalendarScanCursor | null;
      limit: number;
    },
  ): Promise<RepositoryResult<CalendarTaskPage>> {
    let query = this.supabase
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("owner_user_id", input.ownerUserId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(input.limit + 1);

    if (input.cursor) {
      const createdAt = input.cursor.createdAt.replace(/[(),]/g, "");
      const taskId = input.cursor.taskId.replace(/[(),]/g, "");
      query = query.or(
        `created_at.gt.${createdAt},and(created_at.eq.${createdAt},id.gt.${taskId})`,
      );
    }

    const result = await query;
    if (result.error) return failure(result.error);
    const rows = asRows(result.data);
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];

    return {
      ok: true,
      value: {
        tasks: page.map(mapTask),
        nextCursor:
          hasMore && last
            ? { createdAt: String(last.created_at), taskId: String(last.id) }
            : null,
        complete: !hasMore,
      },
    };
  }

  async getTask(
    _actor: AuthenticatedActor,
    input: { ownerUserId: string; taskId: string },
  ): Promise<RepositoryResult<CalendarTaskScanRecord | null>> {
    const result = await this.supabase
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("id", input.taskId)
      .eq("owner_user_id", input.ownerUserId)
      .maybeSingle();
    if (result.error) return failure(result.error);
    return { ok: true, value: result.data ? mapTask(asRow(result.data)) : null };
  }

  async loadMappingsForTasks(
    _actor: AuthenticatedActor,
    input: { ownerUserId: string; destinationKey: string; taskIds: string[] },
  ): Promise<RepositoryResult<CalendarMappingRecord[]>> {
    if (input.taskIds.length === 0) return { ok: true, value: [] };
    const result = await this.supabase
      .from("calendar_event_mappings")
      .select(MAPPING_COLUMNS)
      .eq("owner_user_id", input.ownerUserId)
      .eq("destination_key", input.destinationKey)
      .in("task_id", input.taskIds);
    if (result.error) return failure(result.error);
    return { ok: true, value: asRows(result.data).map(mapMapping) };
  }

  async commitScanPage(
    _actor: AuthenticatedActor,
    commit: CalendarScanCommit,
  ): Promise<RepositoryResult<boolean>> {
    const result = await this.supabase.rpc("calendar_sync_commit_scan_page", {
      p_run_id: commit.runId,
      p_claim_token: commit.claimToken,
      p_next_cursor_created_at: commit.nextCursor?.createdAt ?? null,
      p_next_cursor_task_id: commit.nextCursor?.taskId ?? null,
      p_scan_complete: commit.scanComplete,
      p_items: commit.items.map(toCalendarScanItemPayload),
      p_jobs: commit.jobs.map(toCalendarScanJobPayload),
      p_now: commit.nowIso,
    });
    if (result.error) return failure(result.error);
    return { ok: true, value: Boolean(result.data) };
  }

  async listOrphanMappings(
    _actor: AuthenticatedActor,
    input: { ownerUserId: string; destinationKey: string; limit: number },
  ): Promise<RepositoryResult<CalendarMappingRecord[]>> {
    const result = await this.supabase.rpc("calendar_sync_list_orphan_mappings", {
      p_owner_user_id: input.ownerUserId,
      p_destination_key: input.destinationKey,
      p_limit: input.limit,
    });
    if (result.error) return failure(result.error);
    return { ok: true, value: asRows(result.data).map(mapMapping) };
  }

  async claimJobs(
    actor: AuthenticatedActor,
    input: {
      ownerUserId: string;
      runId: string | null;
      destinationKey: string;
      claimToken: string;
      limit: number;
      nowIso: string;
      leaseSeconds: number;
    },
  ): Promise<RepositoryResult<CalendarJobRecord[]>> {
    const result = await this.supabase.rpc("calendar_sync_claim_jobs", {
      p_owner: input.ownerUserId,
      p_destination_key: input.destinationKey || null,
      p_run_id: input.runId,
      p_claim_token: input.claimToken,
      p_limit: input.limit,
      p_now: input.nowIso,
      p_lease_seconds: input.leaseSeconds,
    });
    if (result.error) return failure(result.error);
    return { ok: true, value: asRows(result.data).map(mapJob) };
  }

  async releaseJobs(
    _actor: AuthenticatedActor,
    input: { jobIds: string[]; claimToken: string; nowIso: string },
  ): Promise<RepositoryResult<void>> {
    if (input.jobIds.length === 0) return { ok: true, value: undefined };
    const result = await this.supabase
      .from("calendar_sync_jobs")
      .update({
        status: "pending",
        claim_token: null,
        lease_expires_at: null,
        updated_at: input.nowIso,
      } as never)
      .in("id", input.jobIds)
      .eq("claim_token", input.claimToken);
    if (result.error) return failure(result.error);
    return { ok: true, value: undefined };
  }

  async isJobClaimCurrent(
    _actor: AuthenticatedActor,
    jobId: string,
    claimToken: string,
  ): Promise<RepositoryResult<boolean>> {
    const result = await this.supabase
      .from("calendar_sync_jobs")
      .select("id")
      .eq("id", jobId)
      .eq("status", "processing")
      .eq("claim_token", claimToken)
      .maybeSingle();
    if (result.error) return failure(result.error);
    return { ok: true, value: Boolean(result.data) };
  }

  async advanceJobGeneration(
    _actor: AuthenticatedActor,
    input: {
      jobId: string;
      claimToken: string;
      generation: number;
      eventId: string;
      payloadHash: string | null;
      nowIso: string;
    },
  ): Promise<RepositoryResult<boolean>> {
    const result = await this.supabase
      .from("calendar_sync_jobs")
      .update({
        generation: input.generation,
        event_exists: false,
        calendar_event_id: input.eventId,
        payload_hash: input.payloadHash,
        updated_at: input.nowIso,
      } as never)
      .eq("id", input.jobId)
      .eq("status", "processing")
      .eq("claim_token", input.claimToken)
      .select("id")
      .maybeSingle();
    if (result.error) return failure(result.error);
    return { ok: true, value: Boolean(result.data) };
  }

  async completeJob(
    _actor: AuthenticatedActor,
    input: {
      job: CalendarJobRecord;
      claimToken: string;
      completion: Parameters<CalendarSyncRepository["completeJob"]>[1]["completion"];
      nowIso: string;
    },
  ): Promise<RepositoryResult<boolean>> {
    const result = await this.supabase
      .from("calendar_sync_jobs")
      .update({
        status: "succeeded",
        outcome: input.completion.outcome,
        calendar_event_id: input.completion.eventId,
        generation: input.completion.generation,
        event_exists: Boolean(input.completion.eventId),
        payload_hash: input.completion.payloadHash,
        exclusion_reason: input.completion.exclusionReason,
        last_error: input.completion.lastError ?? null,
        permanent_failure: Boolean(input.completion.permanentFailure),
        claim_token: null,
        lease_expires_at: null,
        locked_at: null,
        updated_at: input.nowIso,
      } as never)
      .eq("id", input.job.id)
      .eq("status", "processing")
      .eq("claim_token", input.claimToken)
      .select("id")
      .maybeSingle();
    if (result.error) return failure(result.error);
    return { ok: true, value: Boolean(result.data) };
  }

  async failJob(
    _actor: AuthenticatedActor,
    input: {
      job: CalendarJobRecord;
      claimToken: string;
      failure: Parameters<CalendarSyncRepository["failJob"]>[1]["failure"];
      nowIso: string;
    },
  ): Promise<RepositoryResult<boolean>> {
    const result = await this.supabase
      .from("calendar_sync_jobs")
      .update({
        status: input.failure.permanent ? "failed" : "pending",
        outcome: input.failure.outcome,
        exclusion_reason: input.failure.exclusionReason ?? null,
        last_error: input.failure.message,
        permanent_failure: input.failure.permanent,
        scheduled_at: input.failure.retryAt ?? input.nowIso,
        claim_token: null,
        lease_expires_at: null,
        locked_at: null,
        updated_at: input.nowIso,
      } as never)
      .eq("id", input.job.id)
      .eq("status", "processing")
      .eq("claim_token", input.claimToken)
      .select("id")
      .maybeSingle();
    if (result.error) return failure(result.error);
    return { ok: true, value: Boolean(result.data) };
  }

  async upsertMapping(
    _actor: AuthenticatedActor,
    input: {
      ownerUserId: string;
      taskId: string;
      destination: CalendarSyncDestination;
      eventId: string;
      generation: number;
      metadataVerified: boolean;
      payloadHash: string | null;
      nowIso: string;
    },
  ): Promise<RepositoryResult<CalendarMappingRecord>> {
    const result = await this.supabase.rpc("calendar_sync_upsert_mapping", {
      p_owner_user_id: input.ownerUserId,
      p_task_id: input.taskId,
      p_destination_key: input.destination.destinationKey,
      p_google_account_subject: input.destination.accountSubject,
      p_google_account_email: input.destination.accountEmail,
      p_calendar_id: input.destination.calendarId,
      p_event_id: input.eventId,
      p_generation: input.generation,
      p_payload_hash: input.payloadHash,
      p_now: input.nowIso,
    });
    if (result.error) return failure(result.error);
    const row = asRows(result.data)[0];
    if (!row) return failure({ message: "Calendar mapping was not persisted." });
    return { ok: true, value: mapMapping(row) };
  }

  async markMappingRemoved(
    _actor: AuthenticatedActor,
    input: { mapping: CalendarMappingRecord; nowIso: string },
  ): Promise<RepositoryResult<void>> {
    let query = this.supabase
      .from("calendar_event_mappings")
      .update({ status: "removed", updated_at: input.nowIso } as never)
      .eq("owner_user_id", input.mapping.ownerUserId)
      .eq("task_id", input.mapping.taskId)
      .eq("destination_key", input.mapping.destination.destinationKey);
    if (input.mapping.eventId) {
      query = query.eq("event_id", input.mapping.eventId);
    }
    const result = await query;
    if (result.error) return failure(result.error);
    return { ok: true, value: undefined };
  }

  async updateTaskSyncState(
    actor: AuthenticatedActor,
    input: {
      taskId: string;
      eventId: string | null;
      status: "pending" | "synced" | "failed" | "skipped";
      failureReason: string | null;
      nowIso: string;
    },
  ): Promise<RepositoryResult<void>> {
    let query = this.supabase
      .from("tasks")
      .update({
        calendar_event_id: input.eventId,
        calendar_sync_status: input.status,
        calendar_sync_failure_reason: input.failureReason,
        updated_at: input.nowIso,
      } as never)
      .eq("id", input.taskId);
    if (this.scope === "owner") query = query.eq("owner_user_id", actor.userId);
    const result = await query;
    if (result.error) return failure(result.error);
    return { ok: true, value: undefined };
  }

  async updateRunItem(
    _actor: AuthenticatedActor,
    input: {
      runId: string;
      taskId: string;
      outcome: CalendarSyncItemOutcome;
      exclusionReason: CalendarJobRecord["exclusionReason"];
      eventId: string | null;
      payloadHash: string | null;
      errorMessage?: string | null;
      nowIso: string;
    },
  ): Promise<RepositoryResult<void>> {
    const result = await this.supabase
      .from("calendar_sync_run_items")
      .update({
        outcome: input.outcome,
        exclusion_reason: input.exclusionReason,
        event_id: input.eventId,
        payload_hash: input.payloadHash,
        error_message: input.errorMessage ?? null,
        updated_at: input.nowIso,
      } as never)
      .eq("run_id", input.runId)
      .eq("task_id", input.taskId);
    if (result.error) return failure(result.error);
    return { ok: true, value: undefined };
  }

  async countPendingRunJobs(
    _actor: AuthenticatedActor,
    runId: string,
  ): Promise<RepositoryResult<number>> {
    const result = await this.supabase
      .from("calendar_sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId)
      .in("status", ["pending", "processing"]);
    if (result.error) return failure(result.error);
    return { ok: true, value: result.count ?? 0 };
  }

  async completeRunIfDrained(
    _actor: AuthenticatedActor,
    input: { runId: string; nowIso: string },
  ): Promise<RepositoryResult<CalendarRunRecord | null>> {
    const runResult = await this.getRun(_actor, input.runId);
    if (!runResult.ok || !runResult.value) return { ok: true, value: null };
    if (!runResult.value.scanComplete) return { ok: true, value: runResult.value };

    const pending = await this.countPendingRunJobs(_actor, input.runId);
    if (!pending.ok || pending.value > 0) {
      return { ok: true, value: runResult.value };
    }

    const result = await this.supabase
      .from("calendar_sync_runs")
      .update({
        status: "completed",
        completed_at: input.nowIso,
        updated_at: input.nowIso,
      } as never)
      .eq("id", input.runId)
      .eq("status", "active")
      .select(RUN_COLUMNS)
      .maybeSingle();
    if (result.error) return failure(result.error);
    return { ok: true, value: result.data ? mapRun(asRow(result.data)) : runResult.value };
  }

  async listActiveRuns(
    actor: AuthenticatedActor,
    limit: number,
  ): Promise<RepositoryResult<CalendarRunRecord[]>> {
    let query = this.supabase
      .from("calendar_sync_runs")
      .select(RUN_COLUMNS)
      .eq("status", "active")
      .order("updated_at", { ascending: true })
      .limit(limit);
    if (this.scope === "owner") query = query.eq("owner_user_id", actor.userId);
    const result = await query;
    if (result.error) return failure(result.error);
    return { ok: true, value: asRows(result.data).map(mapRun) };
  }

  async listReadyDestinations(
    actor: AuthenticatedActor,
    limit: number,
  ): Promise<RepositoryResult<CalendarReadyQueue[]>> {
    let query = this.supabase
      .from("calendar_sync_jobs")
      .select(
        "owner_user_id, destination_key, google_account_subject, google_account_email, calendar_id",
      )
      .eq("queue_version", 2)
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(Math.max(limit * 20, 50));
    if (this.scope === "owner") query = query.eq("owner_user_id", actor.userId);
    const result = await query;
    if (result.error) return failure(result.error);

    const destinations = new Map<string, CalendarReadyQueue>();
    for (const row of asRows(result.data)) {
      const destination = destinationFromRow(row);
      const ownerUserId = String(row.owner_user_id);
      const key = `${ownerUserId}|${destination.destinationKey}`;
      if (!destinations.has(key)) {
        destinations.set(key, { ownerUserId, destination });
      }
      if (destinations.size >= limit) break;
    }
    return { ok: true, value: [...destinations.values()] };
  }
}

export function mapCalendarJobRow(row: Row): CalendarJobRecord {
  return mapJob(row);
}

export function mapCalendarTaskRow(row: Row): CalendarTaskScanRecord {
  return mapTask(row);
}

export function mapCalendarEventIndexRow(
  row: Row,
): CalendarEventIndexEntry {
  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? "confirmed"),
    source: nullableString(row.source),
    taskId: nullableString(row.taskId),
    ownerUserId: nullableString(row.ownerUserId),
    destinationKey: nullableString(row.destinationKey),
    generation: nullableNumber(row.generation),
    payloadHash: nullableString(row.payloadHash),
  };
}
