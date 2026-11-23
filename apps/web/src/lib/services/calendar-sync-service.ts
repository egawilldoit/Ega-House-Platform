import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getCalendarIntegrationSecretSnapshotForOwner } from "@/lib/services/calendar-settings-service";
import {
  deterministicCalendarEventId,
  isVerifiedCalendarDestination,
  normalizeCalendarDestination,
  sameVerifiedCalendarDestination,
} from "@ega/application/calendar-sync/rules";
import {
  googleCalendarClient,
  syncGoogleCalendarEventForTask,
  type GoogleCalendarClient,
} from "@/lib/services/google-calendar-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type CalendarSyncOperation = "upsert" | "delete";
export type CalendarSyncJobStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed";

type CalendarSyncJobRow = {
  id: string;
  owner_user_id: string;
  task_id: string;
  calendar_event_id: string | null;
  operation: CalendarSyncOperation;
  attempts: number;
  destination_key?: string | null;
  google_account_subject?: string | null;
  google_account_email?: string | null;
  calendar_id?: string | null;
  event_exists?: boolean | null;
  generation?: number | null;
  claim_token?: string | null;
};

type CalendarSyncTaskRow = {
  id: string;
  owner_user_id: string | null;
  title: string;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  calendar_sync_enabled: boolean;
  calendar_reminder_minutes: number;
  calendar_event_id: string | null;
  archived_at: string | null;
};

const MAX_CALENDAR_SYNC_ATTEMPTS = 5;
const DEFAULT_CALENDAR_SYNC_BATCH_SIZE = 10;

const CALENDAR_DESTINATION_UNVERIFIED_MESSAGE =
  "Calendar sync paused because the queued Google account or calendar could not be verified against the connected destination. Reconnect the original Google account or re-enqueue this task; no Google Calendar event was changed.";

type CalendarSyncCredentials = Readonly<{
  google_account_subject: string | null;
  google_account_email: string | null;
  calendar_id: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
}>;

function normalizeJobDestination(job: CalendarSyncJobRow) {
  return normalizeCalendarDestination({
    accountSubject: job.google_account_subject ?? null,
    accountEmail: job.google_account_email ?? null,
    calendarId: job.calendar_id ?? null,
  });
}

/**
 * Scheduled-sync (queue version 1) jobs are written with the destination that
 * was current when they were queued. Before any Google call, prove that the
 * credentials still belong to that same account and calendar. Otherwise the
 * job is paused with an actionable failure instead of being redirected through
 * a newly connected account.
 */
function legacyJobDestinationFailure(
  job: CalendarSyncJobRow,
  credentials: CalendarSyncCredentials,
) {
  const stamped = normalizeJobDestination(job);
  const stampedKey = job.destination_key?.trim() ?? "";

  if (!stampedKey || stamped.destinationKey !== stampedKey) {
    return CALENDAR_DESTINATION_UNVERIFIED_MESSAGE;
  }
  if (!isVerifiedCalendarDestination(stamped)) {
    return CALENDAR_DESTINATION_UNVERIFIED_MESSAGE;
  }
  if (!credentials.connected_at || credentials.disconnected_at) {
    return "Google Calendar is not connected. No Google Calendar event was changed.";
  }

  const current = normalizeCalendarDestination({
    accountSubject: credentials.google_account_subject,
    accountEmail: credentials.google_account_email,
    calendarId: credentials.calendar_id,
  });
  if (
    !isVerifiedCalendarDestination(current) ||
    !sameVerifiedCalendarDestination(stamped, current)
  ) {
    return CALENDAR_DESTINATION_UNVERIFIED_MESSAGE;
  }

  return null;
}

/**
 * A queued event id is usable only when the enqueue proved it was already
 * bound to this task and destination (`event_exists`). An id copied from
 * `tasks.calendar_event_id` on a new connection has no such proof: Google
 * events created by the legacy worker carry no scope metadata, and a switch
 * with no mapping history cannot tell where the old id really lives. Jobs
 * without scoped provenance create a fresh event in the stamped destination
 * instead of patching or deleting the previous account's event.
 */
function scopedJobEventId(job: CalendarSyncJobRow) {
  return job.event_exists === true && job.calendar_event_id
    ? job.calendar_event_id
    : null;
}

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
}

async function getAuthenticatedUserId(supabase: SupabaseServerClient) {
  if (!("auth" in supabase) || typeof supabase.auth?.getUser !== "function") {
    return null;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return null;
  }

  return data.user?.id ?? null;
}

export async function enqueueCalendarSyncJob(
  input: {
    taskId: string;
    operation?: CalendarSyncOperation;
    ownerUserId?: string | null;
    calendarEventId?: string | null;
  },
  options?: { supabase?: SupabaseServerClient; nowIso?: string },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const taskId = input.taskId.trim();
  const operation = input.operation ?? "upsert";
  const nowIso = options?.nowIso ?? new Date().toISOString();

  if (!taskId) {
    return { errorMessage: "Task is required for Calendar sync." };
  }

  let ownerUserId = input.ownerUserId ?? null;
  if (!ownerUserId) {
    const taskResult = await supabase
      .from("tasks")
      .select("owner_user_id")
      .eq("id", taskId)
      .maybeSingle();

    if (taskResult.error) {
      return { errorMessage: "Unable to load task owner for Calendar sync." };
    }

    ownerUserId = taskResult.data?.owner_user_id ?? null;
  }
  // input.calendarEventId and tasks.calendar_event_id are deliberately not
  // adopted here. They predate destination binding and carry no account or
  // calendar scope; only a durable mapping can prove where an event lives.

  ownerUserId ??= await getAuthenticatedUserId(supabase);
  if (!ownerUserId) {
    return { errorMessage: "Unable to resolve Calendar sync owner." };
  }

  let settings: {
    google_account_subject?: string | null;
    google_account_email?: string | null;
    calendar_id?: string | null;
  } = {};
  try {
    const settingsResult = await supabase
      .from("calendar_integration_settings")
      .select("google_account_subject, google_account_email, calendar_id")
      .eq("owner_user_id", ownerUserId)
      .eq("provider", "google")
      .maybeSingle();
    settings = (settingsResult.data ?? {}) as typeof settings;
  } catch {
    // Older deployments and narrow test doubles may not expose Calendar
    // settings; the legacy scheduled-sync queue still accepts the job.
    settings = {};
  }
  const accountKey =
    settings.google_account_email?.trim().toLowerCase() ||
    settings.google_account_subject?.trim() ||
    "unknown-account";
  const destinationKey = `${accountKey}|${settings.calendar_id?.trim() || "primary"}`;

  type CalendarMappingRow = {
    event_id: string | null;
    generation: number | null;
    status: string | null;
  };
  let latestMapping: CalendarMappingRow | null = null;
  try {
    const mappingResult = await supabase
      .from("calendar_event_mappings")
      .select("event_id, generation, status")
      .eq("owner_user_id", ownerUserId)
      .eq("task_id", taskId)
      .eq("destination_key", destinationKey)
      .order("generation", { ascending: false })
      .limit(1)
      .maybeSingle();
    const candidate = (mappingResult.data ?? null) as CalendarMappingRow | null;
    latestMapping =
      candidate &&
      typeof candidate.event_id === "string" &&
      candidate.event_id.length > 0 &&
      (candidate.status === "active" || candidate.status === "removed")
        ? candidate
        : null;
  } catch {
    latestMapping = null;
  }

  let anyDestinationMapping: (CalendarMappingRow & {
    destination_key: string | null;
  }) | null = null;
  try {
    const anyMappingResult = await supabase
      .from("calendar_event_mappings")
      .select("destination_key, event_id, generation, status")
      .eq("owner_user_id", ownerUserId)
      .eq("task_id", taskId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const candidate = (anyMappingResult.data ?? null) as
      | (CalendarMappingRow & { destination_key: string | null })
      | null;
    anyDestinationMapping =
      candidate &&
      typeof candidate.event_id === "string" &&
      candidate.event_id.length > 0
        ? candidate
        : null;
  } catch {
    anyDestinationMapping = null;
  }

  let activeRunId: string | null = null;
  try {
    const activeRunResult = await supabase
      .from("calendar_sync_runs")
      .select("id, status")
      .eq("owner_user_id", ownerUserId)
      .eq("destination_key", destinationKey)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    activeRunId =
      activeRunResult.data?.status === "active"
        ? activeRunResult.data.id
        : null;
  } catch {
    activeRunId = null;
  }

  const staleDestinationMapping = Boolean(
    anyDestinationMapping &&
      anyDestinationMapping.destination_key !== destinationKey,
  );
  const useDurableQueue = true;
  const mappingGeneration = Number(latestMapping?.generation ?? 0);
  const generation =
    latestMapping?.status === "active"
      ? Math.max(1, mappingGeneration)
      : Math.max(1, mappingGeneration + 1);
  // Positive scoped provenance comes only from an active mapping for this
  // exact task and destination. Without one, the deterministic id is a fresh
  // target in the current destination and must be created, never patched or
  // deleted through an id left behind by a previous account or calendar.
  const scopedEventId =
    latestMapping?.status === "active" && latestMapping.event_id
      ? latestMapping.event_id
      : null;
  const eventId =
    scopedEventId ??
    deterministicCalendarEventId({
      ownerUserId,
      taskId,
      destinationKey,
      generation,
    });
  const eventExists = !staleDestinationMapping && Boolean(scopedEventId);

  const { error: taskUpdateError } = await supabase
    .from("tasks")
    .update({
      calendar_sync_status: "pending",
      calendar_sync_failure_reason: null,
      updated_at: nowIso,
    })
    .eq("id", taskId)
    .eq("owner_user_id", ownerUserId);

  if (taskUpdateError) {
    return { errorMessage: "Unable to mark task Calendar sync pending." };
  }

  const jobPayload = {
    owner_user_id: ownerUserId,
    task_id: taskId,
    calendar_event_id: eventId,
    operation,
    status: "pending",
    attempts: 0,
    queue_version: useDurableQueue ? 2 : 1,
    run_id: activeRunId,
    destination_key: destinationKey,
    google_account_subject: settings.google_account_subject ?? null,
    google_account_email: settings.google_account_email ?? null,
    calendar_id: settings.calendar_id?.trim() || "primary",
    generation,
    event_exists: useDurableQueue ? eventExists : false,
    scheduled_at: nowIso,
    updated_at: nowIso,
  };

  const { error } = await supabase.from("calendar_sync_jobs").insert(jobPayload);

  if (error) {
    const isCoalesceConflict =
      (error as { code?: string }).code === "23505" && useDurableQueue;
    if (isCoalesceConflict) {
      const { error: updateError } = await supabase
        .from("calendar_sync_jobs")
        .update({
          calendar_event_id: eventId,
          operation,
          generation,
          event_exists: eventExists,
          run_id: activeRunId,
          last_error: null,
          permanent_failure: false,
          scheduled_at: nowIso,
          updated_at: nowIso,
        } as never)
        .eq("owner_user_id", ownerUserId)
        .eq("task_id", taskId)
        .eq("destination_key", destinationKey)
        .eq("status", "pending")
        .eq("queue_version", 2);

      if (updateError) {
        return { errorMessage: "Unable to enqueue Calendar sync job." };
      }

      return { errorMessage: null };
    }

    return { errorMessage: "Unable to enqueue Calendar sync job." };
  }

  return { errorMessage: null };
}

async function persistRefreshedAccessToken(
  supabase: SupabaseServerClient,
  input: {
    ownerUserId: string;
    expectedUpdatedAt: string;
    refreshedAccessToken?: string;
    tokenExpiresAt?: string | null;
    nowIso: string;
  },
) {
  if (!input.refreshedAccessToken) {
    return null;
  }

  const { error } = await supabase
    .from("calendar_integration_settings")
    .update({
      access_token_encrypted: input.refreshedAccessToken,
      token_expires_at: input.tokenExpiresAt ?? null,
      updated_at: input.nowIso,
    })
    .eq("owner_user_id", input.ownerUserId)
    .eq("provider", "google")
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  return error;
}

async function claimPendingCalendarSyncJobs(
  supabase: SupabaseServerClient,
  input: { limit: number; nowIso: string },
) {
  const { data: candidates, error: loadError } = await supabase
    .from("calendar_sync_jobs")
    .select(
      "id, owner_user_id, task_id, calendar_event_id, operation, attempts, queue_version, destination_key, google_account_subject, google_account_email, calendar_id, event_exists, generation",
    )
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_CALENDAR_SYNC_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(input.limit);

  if (loadError) {
    return { errorMessage: "Unable to load Calendar sync jobs.", jobs: [] };
  }

  const jobs: CalendarSyncJobRow[] = [];
  for (const candidate of (candidates ?? []) as Array<
    CalendarSyncJobRow & { queue_version?: number | null }
  >) {
    // Queue version 2 is owned by the durable manual-sync engine.
    if (candidate.queue_version === 2) continue;
    const { data: claimed, error } = await supabase
      .from("calendar_sync_jobs")
      .update({
        status: "processing",
        claim_token: randomUUID(),
        locked_at: input.nowIso,
        lease_expires_at: new Date(
          new Date(input.nowIso).getTime() + 5 * 60_000,
        ).toISOString(),
        updated_at: input.nowIso,
      })
      .eq("id", candidate.id)
      .in("status", ["pending", "failed"])
      .select(
        "id, owner_user_id, task_id, calendar_event_id, operation, attempts, destination_key, google_account_subject, google_account_email, calendar_id, event_exists, generation, claim_token",
      )
      .maybeSingle();

    if (!error && claimed) {
      jobs.push(claimed as CalendarSyncJobRow);
    }
  }

  return { errorMessage: null, jobs };
}

async function loadCalendarSyncTask(
  supabase: SupabaseServerClient,
  job: CalendarSyncJobRow,
) {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, owner_user_id, title, scheduled_start_at, scheduled_end_at, calendar_sync_enabled, calendar_reminder_minutes, calendar_event_id, archived_at",
    )
    .eq("id", job.task_id)
    .eq("owner_user_id", job.owner_user_id)
    .maybeSingle();

  if (error) {
    return { errorMessage: "Unable to load task for Calendar sync.", data: null };
  }

  return { errorMessage: null, data: data as CalendarSyncTaskRow | null };
}

async function completeCalendarSyncJob(
  supabase: SupabaseServerClient,
  input: {
    job: CalendarSyncJobRow;
    task: CalendarSyncTaskRow | null;
    status: "succeeded" | "failed";
    taskStatus: "synced" | "failed" | "skipped";
    eventId: string | null;
    failureReason: string | null;
    nowIso: string;
  },
) {
  if (!input.job.claim_token) return false;
  const result = await supabase.rpc("calendar_sync_complete_legacy_job", {
    p_job_id: input.job.id,
    p_claim_token: input.job.claim_token,
    p_status: input.status,
    p_task_status: input.taskStatus,
    p_event_id: input.eventId,
    p_failure_reason: input.failureReason,
    p_update_task: Boolean(input.task),
    p_now: input.nowIso,
  });
  return !result.error && result.data === true;
}

export async function processPendingCalendarSyncJobs(options?: {
  supabase?: SupabaseServerClient;
  client?: GoogleCalendarClient;
  limit?: number;
  nowIso?: string;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const claimResult = await claimPendingCalendarSyncJobs(supabase, {
    limit: options?.limit ?? DEFAULT_CALENDAR_SYNC_BATCH_SIZE,
    nowIso,
  });

  if (claimResult.errorMessage) {
    return { ok: false, processed: 0, failed: 0, error: claimResult.errorMessage };
  }

  let processed = 0;
  let failed = 0;
  const client = options?.client ?? googleCalendarClient;

  for (const job of claimResult.jobs) {
    const destination = normalizeJobDestination(job);
    const plannedId = deterministicCalendarEventId({
      ownerUserId: job.owner_user_id,
      taskId: job.task_id,
      destinationKey: destination.destinationKey,
      generation: job.generation ?? 1,
    });
    if (isVerifiedCalendarDestination(destination) &&
        job.destination_key === destination.destinationKey && job.claim_token &&
        job.operation === "upsert" && !job.event_exists && job.calendar_event_id === plannedId) {
      const promoted = await supabase.rpc("calendar_sync_promote_legacy_job", {
        p_job_id: job.id, p_claim_token: job.claim_token, p_now: nowIso,
      });
      if (promoted.error || !promoted.data) failed += 1;
      continue;
    }
    const scopedEventId = scopedJobEventId(job);
    const taskResult = await loadCalendarSyncTask(supabase, job);
    if (taskResult.errorMessage) {
      failed += 1;
      await completeCalendarSyncJob(supabase, {
        job,
        task: null,
        status: "failed",
        taskStatus: "failed",
        eventId: null,
        failureReason: taskResult.errorMessage,
        nowIso,
      });
      continue;
    }
    const task = taskResult.data;

    const needsCalendarWrite = Boolean(
      task || (job.operation === "delete" && scopedEventId),
    );
    if (!needsCalendarWrite) {
      const settled = await completeCalendarSyncJob(supabase, {
        job,
        task: null,
        status: "succeeded",
        taskStatus: "skipped",
        eventId: null,
        failureReason: null,
        nowIso,
      });
      if (settled) processed += 1; else failed += 1;
      continue;
    }

    const settingsResult = await getCalendarIntegrationSecretSnapshotForOwner(
      job.owner_user_id,
      { supabase },
    );
    if (settingsResult.errorMessage) {
      failed += 1;
      await completeCalendarSyncJob(supabase, {
        job,
        task,
        status: "failed",
        taskStatus: "failed",
        eventId: task?.calendar_event_id ?? null,
        failureReason: settingsResult.errorMessage,
        nowIso,
      });
      continue;
    }
    if (!settingsResult.data) {
      failed += 1;
      await completeCalendarSyncJob(supabase, {
        job,
        task,
        status: "failed",
        taskStatus: "failed",
        eventId: task?.calendar_event_id ?? null,
        failureReason:
          "Google Calendar is not connected. No Google Calendar event was changed.",
        nowIso,
      });
      continue;
    }

    const destinationFailure = legacyJobDestinationFailure(
      job,
      settingsResult.data,
    );
    if (destinationFailure) {
      failed += 1;
      await completeCalendarSyncJob(supabase, {
        job,
        task,
        status: "failed",
        taskStatus: "failed",
        eventId: task?.calendar_event_id ?? null,
        failureReason: destinationFailure,
        nowIso,
      });
      continue;
    }

    const settings = settingsResult.data;
    if (job.operation === "upsert" && !job.event_exists) {
      failed += 1;
      await completeCalendarSyncJob(supabase, {
        job, task, status: "failed", taskStatus: "failed",
        eventId: task?.calendar_event_id ?? null,
        failureReason: "Calendar sync cannot safely identify this legacy event. Re-enqueue the task.",
        nowIso,
      });
      continue;
    }

    if (!task) {
      const syncResult = await syncGoogleCalendarEventForTask(
        {
          taskId: job.task_id,
          title: "",
          scheduledStartAt: null,
          scheduledEndAt: null,
          calendarSyncEnabled: false,
          calendarReminderMinutes: 0,
          calendarEventId: scopedEventId,
          archivedAt: nowIso,
        },
        settings,
        { client },
      );

      if (syncResult.status === "failed") {
        failed += 1;
        await completeCalendarSyncJob(supabase, {
          job,
          task: null,
          status: "failed",
          taskStatus: "failed",
          eventId: job.calendar_event_id,
          failureReason: syncResult.failureReason,
          nowIso,
        });
        continue;
      }

      if ("refreshedAccessToken" in syncResult) {
        await persistRefreshedAccessToken(supabase, {
          ownerUserId: job.owner_user_id,
          expectedUpdatedAt: settings.updated_at,
          refreshedAccessToken: syncResult.refreshedAccessToken,
          tokenExpiresAt: syncResult.tokenExpiresAt,
          nowIso,
        });
      }

      const settled = await completeCalendarSyncJob(supabase, {
        job,
        task: null,
        status: "succeeded",
        taskStatus: "synced",
        eventId: null,
        failureReason: null,
        nowIso,
      });
      if (settled) processed += 1; else failed += 1;
      continue;
    }

    const syncResult = await syncGoogleCalendarEventForTask(
      {
        taskId: task.id,
        title: task.title,
        scheduledStartAt: task.scheduled_start_at,
        scheduledEndAt: task.scheduled_end_at,
        calendarSyncEnabled:
          job.operation === "delete" ? false : task.calendar_sync_enabled,
        calendarReminderMinutes: task.calendar_reminder_minutes,
        calendarEventId: scopedEventId,
        archivedAt: task.archived_at,
      },
      settings,
      { client },
    );

    if ("refreshedAccessToken" in syncResult) {
      await persistRefreshedAccessToken(supabase, {
        ownerUserId: job.owner_user_id,
        expectedUpdatedAt: settings.updated_at,
        refreshedAccessToken: syncResult.refreshedAccessToken,
        tokenExpiresAt: syncResult.tokenExpiresAt,
        nowIso,
      });
    }

    if (syncResult.status === "failed") {
      failed += 1;
      await completeCalendarSyncJob(supabase, {
        job,
        task,
        status: "failed",
        taskStatus: "failed",
        eventId: task.calendar_event_id,
        failureReason: syncResult.failureReason,
        nowIso,
      });
      continue;
    }

    const settled = await completeCalendarSyncJob(supabase, {
      job,
      task,
      status: "succeeded",
      taskStatus: syncResult.status,
      eventId: syncResult.eventId,
      failureReason: syncResult.failureReason,
      nowIso,
    });
    if (settled) processed += 1; else failed += 1;
  }

  return { ok: true, processed, failed };
}
