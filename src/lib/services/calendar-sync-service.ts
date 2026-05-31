import { createClient } from "@/lib/supabase/server";
import { getCalendarIntegrationSecretSnapshotForOwner } from "@/lib/services/calendar-settings-service";
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

  const { error } = await supabase.from("calendar_sync_jobs").insert({
    owner_user_id: ownerUserId,
    task_id: taskId,
    calendar_event_id: calendarEventId,
    operation,
    status: "pending",
    attempts: 0,
    updated_at: nowIso,
  });

  if (error) {
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
    .select("id, owner_user_id, task_id, calendar_event_id, operation, attempts")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_CALENDAR_SYNC_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(input.limit);

  if (loadError) {
    return { errorMessage: "Unable to load Calendar sync jobs.", jobs: [] };
  }

  const jobs: CalendarSyncJobRow[] = [];
  for (const candidate of (candidates ?? []) as CalendarSyncJobRow[]) {
    const { data: claimed, error } = await supabase
      .from("calendar_sync_jobs")
      .update({
        status: "processing",
        locked_at: input.nowIso,
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
