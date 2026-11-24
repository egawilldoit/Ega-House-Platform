import type {
  CalendarSyncExclusionReason,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

export const CALENDAR_SYNC_RUN_STATUSES = [
  "active",
  "paused",
  "completed",
  "failed",
] as const;
export type CalendarSyncRunStatus = (typeof CALENDAR_SYNC_RUN_STATUSES)[number];

export const CALENDAR_SYNC_ITEM_OUTCOMES = [
  "pending",
  "created",
  "updated",
  "removed",
  "unchanged",
  "excluded",
  "failed",
] as const;
export type CalendarSyncItemOutcome =
  (typeof CALENDAR_SYNC_ITEM_OUTCOMES)[number];

export type CalendarSyncDestination = Readonly<{
  accountSubject: string | null;
  accountEmail: string | null;
  calendarId: string;
  destinationKey: string;
}>;

export type CalendarConnectionRecord = Readonly<
  CalendarSyncDestination & {
    ownerUserId: string;
    provider: "google";
    timeZone?: string;
    accessTokenEncrypted: string | null;
    refreshTokenEncrypted: string | null;
    tokenExpiresAt: string | null;
    connectedAt: string | null;
    disconnectedAt: string | null;
    reconnectRequiredAt: string | null;
    updatedAt: string;
  }
>;

export type RefreshedCalendarCredentials = Readonly<{
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string | null;
  tokenExpiresAt: string | null;
}>;

export type CalendarRunRecord = Readonly<{
  id: string;
  ownerUserId: string;
  destination: CalendarSyncDestination;
  status: CalendarSyncRunStatus;
  retryMode: boolean;
  scanComplete: boolean;
  scanCursorCreatedAt: string | null;
  scanCursorTaskId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}>;

export type CalendarTaskScanRecord = Readonly<{
  id: string;
  ownerUserId: string;
  title: string;
  status: string;
  archivedAt: string | null;
  completedAt: string | null;
  calendarSyncEnabled: boolean;
  calendarReminderMinutes: number;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  plannedForDate: string | null;
  dueDate: string | null;
  calendarEventId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CalendarMappingRecord = Readonly<{
  id: string;
  ownerUserId: string;
  taskId: string;
  destination: CalendarSyncDestination;
  eventId: string;
  generation: number;
  status: "active" | "removed";
  metadataVerified: boolean;
  payloadHash: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
}>;

export type CalendarJobOperation = "upsert" | "delete";

export type CalendarJobRecord = Readonly<{
  id: string;
  ownerUserId: string;
  taskId: string;
  runId: string | null;
  destination: CalendarSyncDestination;
  operation: CalendarJobOperation;
  status: "pending" | "processing" | "succeeded" | "failed";
  attempts: number;
  eventId: string | null;
  generation: number;
  eventExists: boolean;
  payloadHash: string | null;
  claimToken: string | null;
  permanentFailure: boolean;
  exclusionReason: CalendarSyncExclusionReason | null;
  lastError: string | null;
  scheduledAt: string;
  taskUpdatedAt: string | null;
}>;

export type CalendarScanCursor = Readonly<{
  createdAt: string;
  taskId: string;
}>;

export type CalendarTaskPage = Readonly<{
  tasks: CalendarTaskScanRecord[];
  nextCursor: CalendarScanCursor | null;
  complete: boolean;
}>;

export type CalendarRunItemDraft = Readonly<{
  taskId: string;
  outcome: CalendarSyncItemOutcome;
  exclusionReason: CalendarSyncExclusionReason | null;
  eventId: string | null;
  payloadHash: string | null;
  errorMessage?: string | null;
}>;

export type CalendarScanJobDraft = Readonly<{
  taskId: string;
  operation: CalendarJobOperation;
  eventId: string | null;
  generation: number;
  eventExists: boolean;
  payloadHash: string | null;
  exclusionReason: CalendarSyncExclusionReason | null;
  taskUpdatedAt: string;
}>;

export type CalendarScanCommit = Readonly<{
  runId: string;
  claimToken: string;
  expectedCursor: CalendarScanCursor | null;
  nextCursor: CalendarScanCursor | null;
  scanComplete: boolean;
  items: CalendarRunItemDraft[];
  jobs: CalendarScanJobDraft[];
  nowIso: string;
}>;

export type CalendarRunCounts = Readonly<{
  total: number;
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  excluded: number;
  failed: number;
  pending: number;
  retrying: number;
  processing: number;
  ready: number;
}>;

export type CalendarRunExclusionCount = Readonly<{
  reason: CalendarSyncExclusionReason;
  count: number;
}>;

export type CalendarRunFailure = Readonly<{
  taskId: string;
  message: string;
}>;

/**
 * The provider-confirmed event and generation that a completion may retire.
 * This may advance an older mapping, but cannot overwrite a newer mapping
 * or a different event in the same generation.
 */
export type CalendarMappingRemoval = Readonly<{
  eventId: string;
  generation: number;
}>;

export type CalendarJobCompletion = Readonly<{
  outcome: Extract<
    CalendarSyncItemOutcome,
    "created" | "updated" | "removed" | "unchanged" | "excluded"
  >;
  eventId: string | null;
  generation: number;
  payloadHash: string | null;
  exclusionReason: CalendarSyncExclusionReason | null;
  mappingRemoval?: CalendarMappingRemoval | null;
  lastError?: string | null;
  permanentFailure?: boolean;
  taskSyncStatus: "synced" | "failed" | "skipped";
  taskFailureReason?: string | null;
}>;

export type CalendarJobFailure = Readonly<{
  message: string;
  permanent: boolean;
  retryAt: string | null;
  outcome: Extract<CalendarSyncItemOutcome, "failed" | "excluded">;
  exclusionReason?: CalendarSyncExclusionReason | null;
}>;

export type CalendarEventIndexEntry = Readonly<{
  id: string;
  status: string;
  source: string | null;
  taskId: string | null;
  ownerUserId: string | null;
  destinationKey: string | null;
  generation: number | null;
  payloadHash: string | null;
}>;

export type CalendarEventTime =
  | Readonly<{ date: string; dateTime?: never; timeZone?: never }>
  | Readonly<{ dateTime: string; timeZone?: string; date?: never }>;

export type CalendarEventPayload = Readonly<{
  eventId: string;
  summary: string;
  description: string;
  start: CalendarEventTime;
  end: CalendarEventTime;
  reminderMinutes: number;
  privateProperties: Readonly<Record<string, string>>;
}>;

export type CalendarEventDocument = Readonly<{
  id: string;
  status: string;
  summary: string | null;
  start: CalendarEventTime | null;
  end: CalendarEventTime | null;
  privateProperties: Readonly<Record<string, string>>;
  raw: Readonly<Record<string, unknown>>;
}>;

export type CalendarProviderFailureKind =
  | "authorization"
  | "retryable"
  | "permanent"
  | "not_found"
  | "conflict";

export type CalendarProviderFailure = Readonly<{
  kind: CalendarProviderFailureKind;
  message: string;
  retryAfterSeconds?: number;
}>;

export type CalendarProviderResult<T> =
  | Readonly<{
      ok: true;
      value: T;
      refreshedCredentials?: RefreshedCalendarCredentials;
    }>
  | Readonly<{ ok: false; error: CalendarProviderFailure }>;

export interface CalendarEventProvider {
  listManagedEvents(
    connection: CalendarConnectionRecord,
  ): Promise<
    CalendarProviderResult<{
      complete: boolean;
      events: CalendarEventIndexEntry[];
    }>
  >;
  getEvent(
    connection: CalendarConnectionRecord,
    eventId: string,
  ): Promise<CalendarProviderResult<CalendarEventDocument | null>>;
  createEvent(
    connection: CalendarConnectionRecord,
    payload: CalendarEventPayload,
  ): Promise<CalendarProviderResult<CalendarEventDocument>>;
  updateEvent(
    connection: CalendarConnectionRecord,
    eventId: string,
    payload: CalendarEventPayload,
  ): Promise<CalendarProviderResult<CalendarEventDocument>>;
  deleteEvent(
    connection: CalendarConnectionRecord,
    eventId: string,
  ): Promise<CalendarProviderResult<{ alreadyRemoved: boolean }>>;
}

export type CalendarReadyQueue = Readonly<{
  ownerUserId: string;
  destination: CalendarSyncDestination;
}>;

export interface CalendarSyncRepository {
  getConnection(
    actor: AuthenticatedActor,
  ): Promise<RepositoryResult<CalendarConnectionRecord | null>>;
  getConnectionForOwner(
    actor: AuthenticatedActor,
    ownerUserId: string,
  ): Promise<RepositoryResult<CalendarConnectionRecord | null>>;
  updateConnectionCredentials(
    actor: AuthenticatedActor,
    input: Readonly<{
      ownerUserId: string;
      expectedUpdatedAt: string;
      credentials: RefreshedCalendarCredentials;
      nowIso: string;
    }>,
  ): Promise<RepositoryResult<boolean>>;
  pauseForAuthorization(
    actor: AuthenticatedActor,
    input: Readonly<{
      ownerUserId: string;
      expectedUpdatedAt: string;
      expectedConnectedAt: string | null;
      expectedAccessTokenEncrypted: string | null;
      expectedRefreshTokenEncrypted: string | null;
      runId: string | null;
      fenceListing: boolean;
      expectedCursor: CalendarScanCursor | null;
      message: string;
      nowIso: string;
    }>,
  ): Promise<
    RepositoryResult<
      Readonly<{ credentialsMarked: boolean; runPaused: boolean }>
    >
  >;
  ensureRun(
    actor: AuthenticatedActor,
    input: Readonly<{
      destination: CalendarSyncDestination;
      retryMode: boolean;
      nowIso: string;
    }>,
  ): Promise<RepositoryResult<CalendarRunRecord>>;
  getRun(
    actor: AuthenticatedActor,
    runId: string,
  ): Promise<RepositoryResult<CalendarRunRecord | null>>;
  getLatestRun(
    actor: AuthenticatedActor,
    destinationKey: string,
  ): Promise<RepositoryResult<CalendarRunRecord | null>>;
  getPausedRun(
    actor: AuthenticatedActor,
    destinationKey: string,
  ): Promise<RepositoryResult<CalendarRunRecord | null>>;
  pauseRun(
    actor: AuthenticatedActor,
    runId: string,
    message: string,
    nowIso: string,
  ): Promise<RepositoryResult<void>>;
  recordListingFailure(
    actor: AuthenticatedActor,
    input: Readonly<{
      runId: string;
      expectedCursor: CalendarScanCursor | null;
      pause: boolean;
      retryAt: string | null;
      message: string;
      nowIso: string;
    }>,
  ): Promise<RepositoryResult<boolean>>;
  getRunCounts(
    actor: AuthenticatedActor,
    runId: string,
  ): Promise<RepositoryResult<CalendarRunCounts>>;
  listExclusionCounts(
    actor: AuthenticatedActor,
    runId: string,
  ): Promise<RepositoryResult<CalendarRunExclusionCount[]>>;
  listRunFailures(
    actor: AuthenticatedActor,
    runId: string,
    limit: number,
  ): Promise<RepositoryResult<CalendarRunFailure[]>>;
  claimScan(
    actor: AuthenticatedActor,
    input: Readonly<{
      runId: string;
      claimToken: string;
      nowIso: string;
      leaseSeconds: number;
    }>,
  ): Promise<RepositoryResult<CalendarRunRecord | null>>;
  loadTaskPage(
    actor: AuthenticatedActor,
    input: Readonly<{
      ownerUserId: string;
      cursor: CalendarScanCursor | null;
      limit: number;
    }>,
  ): Promise<RepositoryResult<CalendarTaskPage>>;
  getTask(
    actor: AuthenticatedActor,
    input: Readonly<{ ownerUserId: string; taskId: string }>,
  ): Promise<RepositoryResult<CalendarTaskScanRecord | null>>;
  loadMappingsForTasks(
    actor: AuthenticatedActor,
    input: Readonly<{
      ownerUserId: string;
      taskIds: string[];
    }>,
  ): Promise<RepositoryResult<CalendarMappingRecord[]>>;
  commitScanPage(
    actor: AuthenticatedActor,
    commit: CalendarScanCommit,
  ): Promise<RepositoryResult<boolean>>;
  listOrphanMappings(
    actor: AuthenticatedActor,
    input: Readonly<{
      ownerUserId: string;
      destinationKey: string;
      limit: number;
    }>,
  ): Promise<RepositoryResult<CalendarMappingRecord[]>>;
  claimJobs(
    actor: AuthenticatedActor,
    input: Readonly<{
      ownerUserId: string;
      runId: string | null;
      destinationKey: string;
      claimToken: string;
      limit: number;
      nowIso: string;
      leaseSeconds: number;
    }>,
  ): Promise<RepositoryResult<CalendarJobRecord[]>>;
  releaseJobs(
    actor: AuthenticatedActor,
    input: Readonly<{
      jobIds: string[];
      claimToken: string;
      nowIso: string;
    }>,
  ): Promise<RepositoryResult<void>>;
  isJobClaimCurrent(
    actor: AuthenticatedActor,
    jobId: string,
    claimToken: string,
  ): Promise<RepositoryResult<boolean>>;
  prepareJobRemoval(
    actor: AuthenticatedActor,
    input: Readonly<{ jobId: string; claimToken: string; eventId: string; nowIso: string }>,
  ): Promise<RepositoryResult<boolean>>;
  advanceJobGeneration(
    actor: AuthenticatedActor,
    input: Readonly<{
      jobId: string;
      claimToken: string;
      generation: number;
      eventId: string;
      payloadHash: string | null;
      nowIso: string;
    }>,
  ): Promise<RepositoryResult<boolean>>;
  completeJob(
    actor: AuthenticatedActor,
    input: Readonly<{
      job: CalendarJobRecord;
      claimToken: string;
      completion: CalendarJobCompletion;
      nowIso: string;
    }>,
  ): Promise<RepositoryResult<boolean>>;
  failJob(
    actor: AuthenticatedActor,
    input: Readonly<{
      job: CalendarJobRecord;
      claimToken: string;
      failure: CalendarJobFailure;
      nowIso: string;
    }>,
  ): Promise<RepositoryResult<boolean>>;
  upsertMapping(
    actor: AuthenticatedActor,
    input: Readonly<{
      ownerUserId: string;
      taskId: string;
      destination: CalendarSyncDestination;
      eventId: string;
      generation: number;
      metadataVerified: boolean;
      payloadHash: string | null;
      nowIso: string;
    }>,
  ): Promise<RepositoryResult<CalendarMappingRecord>>;
  updateTaskSyncState(
    actor: AuthenticatedActor,
    input: Readonly<{
      taskId: string;
      eventId: string | null;
      status: "pending" | "synced" | "failed" | "skipped";
      failureReason: string | null;
      nowIso: string;
    }>,
  ): Promise<RepositoryResult<void>>;
  updateRunItem(
    actor: AuthenticatedActor,
    input: Readonly<{
      runId: string;
      taskId: string;
      outcome: CalendarSyncItemOutcome;
      exclusionReason: CalendarSyncExclusionReason | null;
      eventId: string | null;
      payloadHash: string | null;
      errorMessage?: string | null;
      nowIso: string;
    }>,
  ): Promise<RepositoryResult<void>>;
  countPendingRunJobs(
    actor: AuthenticatedActor,
    runId: string,
  ): Promise<RepositoryResult<number>>;
  completeRunIfDrained(
    actor: AuthenticatedActor,
    input: Readonly<{ runId: string; nowIso: string }>,
  ): Promise<RepositoryResult<CalendarRunRecord | null>>;
  listActiveRuns(
    actor: AuthenticatedActor,
    limit: number,
  ): Promise<RepositoryResult<CalendarRunRecord[]>>;
  listReadyDestinations(
    actor: AuthenticatedActor,
    limit: number,
  ): Promise<RepositoryResult<CalendarReadyQueue[]>>;
}
