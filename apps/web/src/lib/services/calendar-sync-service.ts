import { createClient } from "@/lib/supabase/server";
import { getCalendarIntegrationSecretSnapshotForOwner } from "@/lib/services/calendar-settings-service";
import { deterministicCalendarEventId } from "@ega/application/calendar-sync/rules";
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
  let calendarEventId = input.calendarEventId ?? null;
  if (!ownerUserId || calendarEventId === null) {
    const taskResult = await supabase
      .from("tasks")
      .select("owner_user_id, calendar_event_id")
      .eq("id", taskId)
      .maybeSingle();

    if (taskResult.error) {
      return { errorMessage: "Unable to load task owner for Calendar sync." };
    }

    ownerUserId ??= taskResult.data?.owner_user_id ?? null;
    calendarEventId ??= taskResult.data?.calendar_event_id ?? null;
  }

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
  const useDurableQueue = Boolean(
    latestMapping || activeRunId || staleDestinationMapping,
  );
  const mappingGeneration = Number(latestMapping?.generation ?? 0);
  const generation =
    latestMapping?.status === "active"
      ? Math.max(1, mappingGeneration)
      : Math.max(1, mappingGeneration + 1);
  const eventId =
    latestMapping?.status === "active" && latestMapping.event_id
      ? latestMapping.event_id
      : staleDestinationMapping
        ? deterministicCalendarEventId({
            ownerUserId,
            taskId,
            destinationKey,
            generation: 1,
          })
        : calendarEventId ||
          deterministicCalendarEventId({
            ownerUserId,
            taskId,
            destinationKey,
            generation,
          });
  const eventExists =
    !staleDestinationMapping &&
    ((latestMapping?.status === "active" && Boolean(latestMapping.event_id)) ||
      Boolean(calendarEventId));

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
    .eq("provider", "google");

  return error;
}

async function claimPendingCalendarSyncJobs(
  supabase: SupabaseServerClient,
  input: { limit: number; nowIso: string },
) {
  const { data: candidates, error: loadError } = await supabase
    .from("calendar_sync_jobs")
    .select(
      "id, owner_user_id, task_id, calendar_event_id, operation, attempts, queue_version",
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
        locked_at: input.nowIso,
        lease_expires_at: new Date(
          new Date(input.nowIso).getTime() + 5 * 60_000,
        ).toISOString(),
        updated_at: input.nowIso,
      })
      .eq("id", candidate.id)
      .in("status", ["pending", "failed"])
      .select("id, owner_user_id, task_id, calendar_event_id, operation, attempts")
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
  const attempts = input.job.attempts + 1;
  const finalJobStatus =
    input.status === "failed" && attempts < MAX_CALENDAR_SYNC_ATTEMPTS
      ? "failed"
      : input.status;

  await supabase
    .from("calendar_sync_jobs")
    .update({
      status: finalJobStatus,
      attempts,
      last_error: input.failureReason,
      locked_at: null,
      lease_expires_at: null,
      updated_at: input.nowIso,
    })
    .eq("id", input.job.id);

  if (!input.task) {
    return;
  }

  await supabase
    .from("tasks")
    .update({
      calendar_sync_status: input.taskStatus,
      calendar_event_id: input.eventId,
      calendar_sync_failure_reason: input.failureReason,
      updated_at: input.nowIso,
    })
    .eq("id", input.task.id)
    .eq("owner_user_id", input.job.owner_user_id);
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

    if (!taskResult.data && job.operation === "delete" && job.calendar_event_id) {
      const settingsResult = await getCalendarIntegrationSecretSnapshotForOwner(
        job.owner_user_id,
        { supabase },
      );
      if (settingsResult.errorMessage) {
        failed += 1;
        await completeCalendarSyncJob(supabase, {
          job,
          task: null,
          status: "failed",
          taskStatus: "failed",
          eventId: job.calendar_event_id,
          failureReason: settingsResult.errorMessage,
          nowIso,
        });
        continue;
      }

      const syncResult = await syncGoogleCalendarEventForTask(
        {
          taskId: job.task_id,
          title: "",
          scheduledStartAt: null,
          scheduledEndAt: null,
          calendarSyncEnabled: false,
          calendarReminderMinutes: 0,
          calendarEventId: job.calendar_event_id,
          archivedAt: nowIso,
        },
        settingsResult.data,
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

      processed += 1;
      if ("refreshedAccessToken" in syncResult) {
        await persistRefreshedAccessToken(supabase, {
          ownerUserId: job.owner_user_id,
          refreshedAccessToken: syncResult.refreshedAccessToken,
          tokenExpiresAt: syncResult.tokenExpiresAt,
          nowIso,
        });
      }

      await completeCalendarSyncJob(supabase, {
        job,
        task: null,
        status: "succeeded",
        taskStatus: "synced",
        eventId: null,
        failureReason: null,
        nowIso,
      });
      continue;
    }

    if (!taskResult.data) {
      processed += 1;
      await completeCalendarSyncJob(supabase, {
        job,
        task: null,
        status: "succeeded",
        taskStatus: "skipped",
        eventId: null,
        failureReason: null,
        nowIso,
      });
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
        task: taskResult.data,
        status: "failed",
        taskStatus: "failed",
        eventId: taskResult.data.calendar_event_id,
        failureReason: settingsResult.errorMessage,
        nowIso,
      });
      continue;
    }

    const syncResult = await syncGoogleCalendarEventForTask(
      {
        taskId: taskResult.data.id,
        title: taskResult.data.title,
        scheduledStartAt: taskResult.data.scheduled_start_at,
        scheduledEndAt: taskResult.data.scheduled_end_at,
        calendarSyncEnabled:
          job.operation === "delete" ? false : taskResult.data.calendar_sync_enabled,
        calendarReminderMinutes: taskResult.data.calendar_reminder_minutes,
        calendarEventId: taskResult.data.calendar_event_id,
        archivedAt: taskResult.data.archived_at,
      },
      settingsResult.data,
      { client },
    );

    if ("refreshedAccessToken" in syncResult) {
      await persistRefreshedAccessToken(supabase, {
        ownerUserId: job.owner_user_id,
        refreshedAccessToken: syncResult.refreshedAccessToken,
        tokenExpiresAt: syncResult.tokenExpiresAt,
        nowIso,
      });
    }

    if (syncResult.status === "failed") {
      failed += 1;
      await completeCalendarSyncJob(supabase, {
        job,
        task: taskResult.data,
        status: "failed",
        taskStatus: "failed",
        eventId: taskResult.data.calendar_event_id,
        failureReason: syncResult.failureReason,
        nowIso,
      });
      continue;
    }

    processed += 1;
    await completeCalendarSyncJob(supabase, {
      job,
      task: taskResult.data,
      status: "succeeded",
      taskStatus: syncResult.status,
      eventId: syncResult.eventId,
      failureReason: syncResult.failureReason,
      nowIso,
    });
  }

  return { ok: true, processed, failed };
}
