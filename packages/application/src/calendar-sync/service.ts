import { randomUUID } from "node:crypto";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
} from "../shared/result";

import {
  buildCalendarEventPayload,
  deterministicCalendarEventId,
  isVerifiedCalendarDestination,
  nextCalendarRetryAtIso,
  normalizeCalendarDestination,
  sameVerifiedCalendarDestination,
  CALENDAR_SYNC_DEFAULT_BATCH_BUDGET_MS,
  CALENDAR_SYNC_DEFAULT_JOB_LIMIT,
  CALENDAR_SYNC_DEFAULT_LEASE_SECONDS,
  CALENDAR_SYNC_DEFAULT_SCAN_PAGE_SIZE,
  CALENDAR_SYNC_MAX_ATTEMPTS,
} from "./rules";
import type {
  CalendarConnectionRecord,
  CalendarProviderFailure,
  CalendarProviderResult,
  CalendarEventDocument,
  CalendarEventIndexEntry,
  CalendarEventProvider,
  CalendarJobRecord,
  CalendarMappingRecord,
  CalendarRunCounts,
  CalendarRunExclusionCount,
  CalendarRunFailure,
  CalendarRunRecord,
  CalendarScanCommit,
  CalendarScanCursor,
  RefreshedCalendarCredentials,
  CalendarScanJobDraft,
  CalendarRunItemDraft,
  CalendarSyncDestination,
  CalendarSyncRepository,
  CalendarTaskScanRecord,
} from "./ports";

export type CalendarSyncConfig = Readonly<{
  linkBaseUrl: string;
  scanPageSize?: number;
  jobLimit?: number;
  requestBudgetMs?: number;
  leaseSeconds?: number;
}>;

export type CalendarSyncDependencies = Readonly<{
  repository: CalendarSyncRepository;
  provider: CalendarEventProvider;
  config: CalendarSyncConfig;
  now?: () => Date;
}>;

export type CalendarSyncConnectionView = Readonly<{
  connected: boolean;
  needsReconnect: boolean;
  accountEmail: string | null;
  calendarId: string;
  destinationKey: string;
}>;

/**
 * Read failures from the repository calls that build the status view. Null
 * means the read succeeded and returned a legitimately empty value; a string
 * flags the corresponding status information as unavailable. A successful
 * read with zero counts is still a real `CalendarRunCounts`, never null.
 */
export type CalendarSyncRunReadErrors = Readonly<{
  counts: string | null;
  exclusions: string | null;
  failures: string | null;
}>;

export type CalendarSyncStatusView = Readonly<{
  connection: CalendarSyncConnectionView;
  run: CalendarSyncRunView | null;
  pausedRun: CalendarRunRecord | null;
  message: string | null;
  continuationBlocked: boolean;
  statusErrors: Readonly<{
    connection: string | null;
    run: string | null;
    pausedRun: string | null;
  }>;
}>;

export type CalendarSyncRunView = Readonly<{
  id: string;
  status: CalendarRunRecord["status"];
  retryMode: boolean;
  scanComplete: boolean;
  counts: CalendarRunCounts | null;
  exclusions: CalendarRunExclusionCount[] | null;
  failures: CalendarRunFailure[] | null;
  hasMore: boolean;
  lastError: string | null;
  startedAt: string;
  completedAt: string | null;
  statusErrors: CalendarSyncRunReadErrors;
}>;

export type CalendarSyncProcessResult =
  | Readonly<{
      ok: true;
      status: CalendarSyncStatusView;
      authFailure: boolean;
      retryable: boolean;
    }>
  | Readonly<{
      ok: false;
      errorMessage: string;
    }>;

function requireActor(actor: AuthenticatedActor) {
  if (!actor?.userId) return applicationFailure("Authentication required.");
  return null;
}

function getNow(deps: CalendarSyncDependencies) {
  return deps.now?.() ?? new Date();
}

function getConfig(deps: CalendarSyncDependencies) {
  return {
    linkBaseUrl: deps.config.linkBaseUrl.replace(/\/+$/, ""),
    scanPageSize:
      deps.config.scanPageSize ?? CALENDAR_SYNC_DEFAULT_SCAN_PAGE_SIZE,
    jobLimit: deps.config.jobLimit ?? CALENDAR_SYNC_DEFAULT_JOB_LIMIT,
    requestBudgetMs:
      deps.config.requestBudgetMs ?? CALENDAR_SYNC_DEFAULT_BATCH_BUDGET_MS,
    leaseSeconds:
      deps.config.leaseSeconds ?? CALENDAR_SYNC_DEFAULT_LEASE_SECONDS,
  };
}

function isConnectionUsable(connection: CalendarConnectionRecord | null) {
  return Boolean(
    connection &&
      connection.provider === "google" &&
      connection.connectedAt &&
      !connection.disconnectedAt &&
      !connection.reconnectRequiredAt &&
      (connection.accessTokenEncrypted || connection.refreshTokenEncrypted),
  );
}

function destinationOfConnection(
  connection: CalendarConnectionRecord,
): CalendarSyncDestination {
  return normalizeCalendarDestination({
    accountSubject: connection.accountSubject,
    accountEmail: connection.accountEmail,
    calendarId: connection.calendarId,
  });
}

function connectionView(
  connection: CalendarConnectionRecord | null,
): CalendarSyncConnectionView {
  const destination = connection
    ? destinationOfConnection(connection)
    : normalizeCalendarDestination({
        accountSubject: null,
        accountEmail: null,
        calendarId: "primary",
      });

  return {
    connected: Boolean(
      connection &&
        connection.connectedAt &&
        !connection.disconnectedAt &&
        connection.provider === "google",
    ),
    needsReconnect: Boolean(
      connection?.reconnectRequiredAt ||
        (connection && !connection.refreshTokenEncrypted),
    ),
    accountEmail: connection?.accountEmail ?? null,
    calendarId: destination.calendarId,
    destinationKey: destination.destinationKey,
  };
}

function statusReadFailed(label: string): string {
  return `Unable to load the Calendar sync ${label}. The status may be out of date.`;
}

function statusMessageFor(
  run: CalendarSyncRunView | null,
  pausedRun: CalendarRunRecord | null,
): string | null {
  return run?.status === "paused" && run.lastError
    ? run.lastError
    : pausedRun
      ? `Sync for ${pausedRun.destination.calendarId} is paused. Events already published there remain in that calendar.`
      : null;
}

function listingBackedOff(run: CalendarRunRecord, now: Date): boolean {
  return !run.scanComplete && Boolean(run.nextRetryAt && Date.parse(run.nextRetryAt) > now.getTime());
}

async function loadRunView(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  run: CalendarRunRecord | null,
): Promise<CalendarSyncRunView | null> {
  if (!run) return null;

  const [counts, exclusions, failures] = await Promise.all([
    deps.repository.getRunCounts(actor, run.id),
    deps.repository.listExclusionCounts(actor, run.id),
    deps.repository.listRunFailures(actor, run.id, 8),
  ]);

  // A failed read is not an empty result: counts, exclusions and failures are
  // null and flagged via statusErrors. A successful read with zero counts is
  // still a real CalendarRunCounts, so hasMore stays correct on real data.
  const hasMore =
    run.status === "active" &&
    !listingBackedOff(run, getNow(deps)) &&
    (!run.scanComplete || (counts.ok && counts.value.ready > 0));

  return {
    id: run.id,
    status: run.status,
    retryMode: run.retryMode,
    scanComplete: run.scanComplete,
    counts: counts.ok ? counts.value : null,
    exclusions: exclusions.ok ? exclusions.value : null,
    failures: failures.ok ? failures.value : null,
    hasMore,
    lastError: run.lastError,
    startedAt: run.createdAt,
    completedAt: run.completedAt,
    statusErrors: {
      counts: counts.ok ? null : statusReadFailed("run counts"),
      exclusions: exclusions.ok ? null : statusReadFailed("exclusion counts"),
      failures: failures.ok ? null : statusReadFailed("failure records"),
    },
  };
}

export async function getCalendarSyncStatus(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
): Promise<ApplicationResult<CalendarSyncStatusView>> {
  const actorError = requireActor(actor);
  if (actorError) return actorError;

  const connectionResult = await deps.repository.getConnection(actor);
  if (!connectionResult.ok) {
    return applicationFailure("Unable to load Calendar connection.");
  }

  const connection = connectionResult.value;
  const destination = connection
    ? destinationOfConnection(connection)
    : normalizeCalendarDestination({
        accountSubject: null,
        accountEmail: null,
        calendarId: "primary",
      });

  const [latestRunResult, pausedRunResult] = await Promise.all([
    deps.repository.getLatestRun(actor, destination.destinationKey),
    deps.repository.getPausedRun(actor, destination.destinationKey),
  ]);
  const latestRun = latestRunResult.ok ? latestRunResult.value : null;
  const pausedRun = pausedRunResult.ok ? pausedRunResult.value : null;
  const run = await loadRunView(actor, deps, latestRun);

  return applicationSuccess({
    connection: connectionView(connection),
    run,
    pausedRun,
    message: statusMessageFor(run, pausedRun),
    continuationBlocked: false,
    statusErrors: {
      connection: null,
      run: latestRunResult.ok ? null : "Unable to load the latest Calendar sync run.",
      pausedRun: pausedRunResult.ok
        ? null
        : "Unable to load a paused Calendar sync run.",
    },
  });
}

function isAuthorizationFailure(
  error: Readonly<{ kind: string }> | null | undefined,
) {
  return error?.kind === "authorization";
}

type AuthorizationPauseResult =
  | Readonly<{ ok: true; applied: boolean; runPaused: boolean }>
  | Readonly<{ ok: false; message: string }>;

async function pauseForAuthorization(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  input: {
    runId: string | null;
    connection: CalendarConnectionRecord;
    expectedListingCursor?: CalendarScanCursor | null;
    expectedListingRevision?: number;
    fenceListingPause?: boolean;
    message: string;
    nowIso: string;
  },
): Promise<AuthorizationPauseResult> {
  // Atomically check the credential revision, mark reconnect_required_at, and
  // pause the run in a single database transaction that serializes with OAuth
  // reconnect on the calendar_integration_settings row lock.
  const paused = await deps.repository.pauseForAuthorization(actor, {
    ownerUserId: input.connection.ownerUserId,
    expectedUpdatedAt: input.connection.updatedAt,
    expectedConnectedAt: input.connection.connectedAt,
    expectedAccessTokenEncrypted: input.connection.accessTokenEncrypted,
    expectedRefreshTokenEncrypted: input.connection.refreshTokenEncrypted,
    runId: input.runId,
    fenceListing: Boolean(input.fenceListingPause),
    expectedCursor: input.expectedListingCursor ?? null,
    expectedListingRevision: input.expectedListingRevision,
    message: input.message,
    nowIso: input.nowIso,
  });
  if (!paused.ok) {
    return {
      ok: false,
      message: "Unable to save Google Calendar authorization pause state.",
    };
  }
  return {
    ok: true,
    applied: paused.value.credentialsMarked,
    runPaused: paused.value.runPaused,
  };
}

function eventIndexFor(
  events: CalendarEventIndexEntry[],
): Map<string, CalendarEventIndexEntry> {
  return new Map(events.map((event) => [event.id, event]));
}

type IndexedEventCheck =
  | { kind: "ok" }
  | { kind: "missing" }
  | { kind: "conflict"; message: string };

function checkIndexedEvent(input: {
  event: CalendarEventIndexEntry | undefined;
  task: CalendarTaskScanRecord;
  destination: CalendarSyncDestination;
}): IndexedEventCheck {
  const { event, task, destination } = input;
  if (!event || event.status === "cancelled") {
    return { kind: "missing" };
  }

  if (event.source && event.source !== "ega-house") {
    return {
      kind: "conflict",
      message: "A calendar event with this id belongs to a different source.",
    };
  }

  if (event.taskId && event.taskId !== task.id) {
    return {
      kind: "conflict",
      message: "A calendar event with this id belongs to a different task.",
    };
  }

  if (event.ownerUserId && event.ownerUserId !== task.ownerUserId) {
    return {
      kind: "conflict",
      message: "A calendar event with this id belongs to a different owner.",
    };
  }

  if (event.destinationKey && event.destinationKey !== destination.destinationKey) {
    return {
      kind: "conflict",
      message: "A calendar event with this id belongs to a different destination.",
    };
  }

  return { kind: "ok" };
}

function pickMappings(
  mappings: CalendarMappingRecord[],
  destinationKey: string,
): Map<string, { active: CalendarMappingRecord | null; latest: CalendarMappingRecord | null }> {
  const result = new Map<
    string,
    { active: CalendarMappingRecord | null; latest: CalendarMappingRecord | null }
  >();

  for (const mapping of mappings) {
    if (mapping.destination.destinationKey !== destinationKey) continue;
    const current = result.get(mapping.taskId) ?? {
      active: null,
      latest: null,
    };
    if (mapping.status === "active" && !current.active) {
      current.active = mapping;
    }
    if (!current.latest || mapping.generation > current.latest.generation) {
      current.latest = mapping;
    }
    result.set(mapping.taskId, current);
  }

  return result;
}

type LegacyEventProvenance = "none" | "verified" | "unverified";

const UNVERIFIED_LEGACY_EVENT_MESSAGE =
  "The saved Calendar event belongs to a different Google account or calendar. Sync for this task is paused and the saved event id was not adopted. Reconnect the original destination or clear the saved event id, then retry.";

const MAPPED_EVENT_LOOKUP_FAILED_MESSAGE =
  "The saved Calendar event could not be verified in Google Calendar, so it was left unchanged.";

function indexEntryFromDocument(
  document: CalendarEventDocument,
): CalendarEventIndexEntry {
  const privateProperties = document.privateProperties;
  return {
    id: document.id,
    status: document.status,
    source: privateProperties.source ?? null,
    taskId: privateProperties.task_id ?? null,
    ownerUserId: privateProperties.owner_user_id ?? null,
    destinationKey: privateProperties.destination_key ?? null,
    generation: privateProperties.generation
      ? Number(privateProperties.generation)
      : null,
    payloadHash: privateProperties.payload_hash ?? null,
  };
}

/**
 * An unscoped `tasks.calendar_event_id` may be adopted only when the event's
 * private metadata explicitly names this source, task, owner and destination.
 * `checkIndexedEvent` is deliberately permissive for *established* mappings —
 * a mapped event whose tag was stripped is still repaired in place — but that
 * tolerance is not proof for an id that has no durable scope. A source-only
 * tag (or a missing task/owner/destination tag) could describe any task's
 * event, so it must never authorize an update or delete under a new account.
 */
function hasExplicitScopedProvenance(input: {
  event: CalendarEventIndexEntry;
  task: CalendarTaskScanRecord;
  destination: CalendarSyncDestination;
}) {
  const { event, task, destination } = input;
  return (
    event.source === "ega-house" &&
    event.taskId === task.id &&
    event.ownerUserId === task.ownerUserId &&
    event.destinationKey === destination.destinationKey
  );
}

/**
 * `tasks.calendar_event_id` predates destination binding. Adopt it only when
 * the current destination's completed listing positively ties that event to
 * this task, owner and destination. An unscoped id is not proof by itself:
 * neither the absence of mapping history nor the presence of an event with
 * a matching id is enough unless its metadata explicitly carries the full
 * scope. A first sync under a different account must not update, delete or
 * adopt an event that belongs to the previous account.
 */
function legacyEventProvenance(input: {
  task: CalendarTaskScanRecord;
  destination: CalendarSyncDestination;
  hasCurrentMapping: boolean;
  hasOtherDestinationMapping: boolean;
  eventIndex: Map<string, CalendarEventIndexEntry>;
}): LegacyEventProvenance {
  if (!input.task.calendarEventId || input.hasCurrentMapping) return "none";
  // Mapping history for another destination already proves the unscoped id
  // belongs elsewhere, even if a same-id event is now visible here.
  if (input.hasOtherDestinationMapping) return "unverified";
  const event = input.eventIndex.get(input.task.calendarEventId);
  if (!event || event.status === "cancelled") return "unverified";
  return hasExplicitScopedProvenance({
    event,
    task: input.task,
    destination: input.destination,
  })
    ? "verified"
    : "unverified";
}

type PlannedScanItem = Readonly<{
  item: CalendarRunItemDraft;
  job: CalendarScanJobDraft | null;
  refreshedCredentials?: RefreshedCalendarCredentials;
}> | { lookupFailure: CalendarProviderFailure };

async function planTaskForScan(input: {
  deps: CalendarSyncDependencies;
  connection: CalendarConnectionRecord;
  task: CalendarTaskScanRecord;
  destination: CalendarSyncDestination;
  eventIndex: Map<string, CalendarEventIndexEntry>;
  mapping: CalendarMappingRecord | null;
  latestMapping: CalendarMappingRecord | null;
  hasOtherDestinationMapping: boolean;
}): Promise<PlannedScanItem> {
  const { task, destination, eventIndex, mapping, latestMapping } = input;
  let refreshedCredentials: RefreshedCalendarCredentials | undefined;
  const ownerUserId = task.ownerUserId;
  const nextGeneration = (latestMapping?.generation ?? 0) + 1;
  const currentGeneration = mapping?.generation ?? nextGeneration;
  const provenance = legacyEventProvenance({
    task,
    destination,
    hasCurrentMapping: Boolean(mapping),
    hasOtherDestinationMapping: input.hasOtherDestinationMapping,
    eventIndex,
  });
  const currentEventId =
    mapping?.eventId ??
    (provenance === "verified" ? task.calendarEventId : null) ??
    deterministicCalendarEventId({
      ownerUserId,
      taskId: task.id,
      destinationKey: destination.destinationKey,
      generation: currentGeneration,
    });

  const built = buildCalendarEventPayload({
    ownerUserId,
    task,
    destination,
    generation: currentGeneration,
    eventId: currentEventId,
    linkBaseUrl: input.deps.config.linkBaseUrl,
    timeZone: input.connection.timeZone,
  });

  if (built.plan.kind === "excluded") {
    const hasManagedEvent = Boolean(
      mapping?.status === "active" ||
        (provenance === "verified" && task.calendarEventId),
    );

    if (!hasManagedEvent) {
      return {
        item: {
          taskId: task.id,
          outcome: "excluded",
          exclusionReason: built.plan.exclusionReason,
          eventId: null,
          payloadHash: null,
        },
        job: null,
      };
    }

    return {
      item: {
        taskId: task.id,
        outcome: "pending",
        exclusionReason: built.plan.exclusionReason,
        eventId: null,
        payloadHash: null,
      },
      job: {
        taskId: task.id,
        operation: "delete",
        eventId: currentEventId,
        generation: currentGeneration,
        eventExists: true,
        payloadHash: null,
        exclusionReason: built.plan.exclusionReason,
        taskUpdatedAt: task.updatedAt,
      },
    };
  }

  if (provenance === "unverified") {
    return {
      item: {
        taskId: task.id,
        outcome: "failed",
        exclusionReason: null,
        eventId: null,
        payloadHash: null,
        errorMessage: UNVERIFIED_LEGACY_EVENT_MESSAGE,
      },
      job: null,
    };
  }

  const event = eventIndex.get(currentEventId);
  const indexedCheck = checkIndexedEvent({ event, task, destination });

  if (indexedCheck.kind === "conflict") {
    return {
      item: {
        taskId: task.id,
        outcome: "failed",
        exclusionReason: null,
        eventId: currentEventId,
        payloadHash: null,
        errorMessage: indexedCheck.message,
      },
      job: null,
    };
  }

  if (mapping?.status === "active") {
    if (indexedCheck.kind === "ok") {
      const unchanged =
        event?.payloadHash === built.payloadHash &&
        event?.generation === currentGeneration &&
        event?.taskId === task.id &&
        event?.source === "ega-house";

      if (unchanged) {
        return {
          item: {
            taskId: task.id,
            outcome: "unchanged",
            exclusionReason: null,
            eventId: mapping.eventId,
            payloadHash: built.payloadHash,
          },
          job: null,
        };
      }

      return {
        item: {
          taskId: task.id,
          outcome: "pending",
          exclusionReason: null,
          eventId: mapping.eventId,
          payloadHash: built.payloadHash,
        },
        job: {
          taskId: task.id,
          operation: "upsert",
          eventId: mapping.eventId,
          generation: mapping.generation,
          eventExists: true,
          payloadHash: built.payloadHash,
          exclusionReason: null,
          taskUpdatedAt: task.updatedAt,
        },
      };
    }

    // The managed event is absent from the complete tagged-event listing.
    // The listing is filtered by the EGA House source tag, so absence alone
    // does not prove deletion: a live event whose tag was stripped is still
    // present in the calendar. Look it up in the verified destination before
    // planning any regeneration. A definitive 404/410 (or a cancelled event)
    // is the only evidence that advances the generation.
    const lookup = await input.deps.provider.getEvent(
      input.connection,
      mapping.eventId,
    );
    if (!lookup.ok) {
      if (lookup.error.kind === "authorization" || lookup.error.kind === "retryable") {
        return { lookupFailure: lookup.error };
      }
      // An unreadable, forbidden or transient lookup is ambiguous. Keep the
      // mapping and the live event unchanged, and let the next run re-verify.
      return {
        item: {
          taskId: task.id,
          outcome: "failed",
          exclusionReason: null,
          eventId: mapping.eventId,
          payloadHash: null,
          errorMessage: `${MAPPED_EVENT_LOOKUP_FAILED_MESSAGE} ${lookup.error.message}`,
        },
        job: null,
      };
    }

    refreshedCredentials = lookup.refreshedCredentials;
    const liveCheck = lookup.value
      ? checkIndexedEvent({
          event: indexEntryFromDocument(lookup.value),
          task,
          destination,
        })
      : ({ kind: "missing" } as const);

    if (liveCheck.kind === "conflict") {
      return {
        item: {
          taskId: task.id,
          outcome: "failed",
          exclusionReason: null,
          eventId: mapping.eventId,
          payloadHash: null,
          errorMessage: liveCheck.message,
        },
        job: null,
        refreshedCredentials,
      };
    }

    if (liveCheck.kind === "ok") {
      // The event is live in the verified destination but its source tag is
      // missing. Keep its id and generation and repair the metadata in place
      // instead of publishing a second copy under a new deterministic id.
      return {
        item: {
          taskId: task.id,
          outcome: "pending",
          exclusionReason: null,
          eventId: mapping.eventId,
          payloadHash: built.payloadHash,
        },
        job: {
          taskId: task.id,
          operation: "upsert",
          eventId: mapping.eventId,
          generation: mapping.generation,
          eventExists: true,
          payloadHash: built.payloadHash,
          exclusionReason: null,
          taskUpdatedAt: task.updatedAt,
        },
        refreshedCredentials,
      };
    }

    // Google definitively confirmed removal. Keep the mapping active until the
    // replacement publication finalizes; the upsert itself advances the
    // mapping generation, so a crash before the job is durable cannot hide an
    // event that still exists. A legacy mapping gets one bounded update
    // attempt, which repairs or advances the generation.
    // A 404 can also mean the calendar became inaccessible. Verify reachability
    // before treating absence as a confirmed deletion.
    if (liveCheck.kind === "missing" && mapping.metadataVerified) {
      const accessible = await input.deps.provider.isCalendarAccessible(
        input.connection,
      );
      if (!accessible.ok || !accessible.value) {
        return {
          item: {
            taskId: task.id,
            outcome: "failed",
            exclusionReason: null,
            eventId: mapping.eventId,
            payloadHash: null,
            errorMessage: accessible.ok
              ? "Google Calendar is inaccessible. Reconnect and retry."
              : accessible.error.message,
          },
          job: null,
          refreshedCredentials,
        };
      }
    }
    if (mapping.metadataVerified) {
      const eventId = deterministicCalendarEventId({
        ownerUserId,
        taskId: task.id,
        destinationKey: destination.destinationKey,
        generation: nextGeneration,
      });

      return {
        item: {
          taskId: task.id,
          outcome: "pending",
          exclusionReason: null,
          eventId,
          payloadHash: built.payloadHash,
        },
        job: {
          taskId: task.id,
          operation: "upsert",
          eventId,
          generation: nextGeneration,
          eventExists: false,
          payloadHash: built.payloadHash,
          exclusionReason: null,
          taskUpdatedAt: task.updatedAt,
        },
        refreshedCredentials,
      };
    }
  }

  return {
    item: {
      taskId: task.id,
      outcome: "pending",
      exclusionReason: null,
      eventId: currentEventId,
      payloadHash: built.payloadHash,
    },
    job: {
      taskId: task.id,
      operation: "upsert",
      eventId: currentEventId,
      generation: currentGeneration,
      eventExists: Boolean(
        mapping || (provenance === "verified" && task.calendarEventId),
      ),
      payloadHash: built.payloadHash,
      exclusionReason: null,
      taskUpdatedAt: task.updatedAt,
    },
    refreshedCredentials,
  };
}

async function scanRun(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  input: {
    run: CalendarRunRecord;
    connection: CalendarConnectionRecord;
    eventIndex: Map<string, CalendarEventIndexEntry>;
    deadline: number;
    nowIso: string;
  },
): Promise<
  | {
      ok: true;
      run: CalendarRunRecord;
      refreshedCredentials?: RefreshedCalendarCredentials;
    }
  | {
      ok: false;
      message: string;
      authFailure?: boolean;
      staleAuth?: boolean;
      persistenceFailure?: boolean;
      retryable?: boolean;
    }
> {
  const config = getConfig(deps);
  let run = input.run;
  let refreshedCredentials: RefreshedCalendarCredentials | undefined;

  let tasksExhausted = false;
  while (!run.scanComplete && !tasksExhausted && Date.now() < input.deadline) {
    const claimToken = randomUUID();
    const claimed = await deps.repository.claimScan(actor, {
      runId: run.id,
      claimToken,
      nowIso: input.nowIso,
      leaseSeconds: config.leaseSeconds,
    });

    if (!claimed.ok) {
      return { ok: false, message: "Unable to claim the Calendar sync scan." };
    }
    if (!claimed.value) {
      return {
        ok: false,
        message: "Another request is already continuing this Calendar sync.",
        retryable: true,
      };
    }

    run = claimed.value;
    const expectedCursor = run.scanCursorCreatedAt && run.scanCursorTaskId
      ? { createdAt: run.scanCursorCreatedAt, taskId: run.scanCursorTaskId }
      : null;
    const pageResult = await deps.repository.loadTaskPage(actor, {
      ownerUserId: run.ownerUserId,
      cursor: expectedCursor,
      limit: config.scanPageSize,
    });
    if (!pageResult.ok) {
      return { ok: false, message: "Unable to load tasks for Calendar sync." };
    }

    const page = pageResult.value;
    const mappingsResult = await deps.repository.loadMappingsForTasks(actor, {
      ownerUserId: run.ownerUserId,
      taskIds: page.tasks.map((task) => task.id),
    });
    if (!mappingsResult.ok) {
      return { ok: false, message: "Unable to load Calendar event mappings." };
    }

    const mappingByTask = pickMappings(
      mappingsResult.value,
      run.destination.destinationKey,
    );
    const otherDestinationTaskIds = new Set(
      mappingsResult.value
        .filter(
          (mapping) =>
            mapping.destination.destinationKey !==
            run.destination.destinationKey,
        )
        .map((mapping) => mapping.taskId),
    );
    const items: CalendarRunItemDraft[] = [];
    const jobs: CalendarScanJobDraft[] = [];

    for (const task of page.tasks) {
      const mappingState = mappingByTask.get(task.id) ?? {
        active: null,
        latest: null,
      };
      const planned = await planTaskForScan({
        deps,
        connection: input.connection,
        task,
        destination: run.destination,
        eventIndex: input.eventIndex,
        mapping: mappingState.active,
        latestMapping: mappingState.latest,
        hasOtherDestinationMapping: otherDestinationTaskIds.has(task.id),
      });
      if ("lookupFailure" in planned) {
        const authFailure = planned.lookupFailure.kind === "authorization";
        const released = await deps.repository.commitScanPage(actor, {
          runId: run.id,
          claimToken,
          expectedCursor,
          nextCursor: expectedCursor,
          scanComplete: false,
          retryAt: authFailure ? undefined : nextCalendarRetryAtIso({
            jobId: run.id,
            attempts: 1,
            now: getNow(deps),
            retryAfterSeconds: planned.lookupFailure.retryAfterSeconds,
          }),
          items: [],
          jobs: [],
          nowIso: input.nowIso,
        });
        if (!released.ok) {
          return { ok: false, message: "Unable to save Calendar scan retry state.", persistenceFailure: true };
        }
        if (!released.value) {
          return { ok: false, message: "Calendar scan claim changed; retry to continue.", retryable: true };
        }
        if (authFailure) {
          const paused = await pauseForAuthorization(actor, deps, {
            runId: run.id,
            connection: input.connection,
            expectedListingCursor: expectedCursor,
            fenceListingPause: true,
            message: planned.lookupFailure.message,
            nowIso: input.nowIso,
          });
          if (!paused.ok) {
            return {
              ok: false,
              message: paused.message,
              persistenceFailure: true,
            };
          }
          if (!paused.applied) {
            return {
              ok: false,
              message: planned.lookupFailure.message,
              authFailure: false,
              staleAuth: true,
              retryable: false,
            };
          }
        }
        return { ok: false, message: planned.lookupFailure.message, authFailure, retryable: !authFailure };
      }
      refreshedCredentials =
        planned.refreshedCredentials ?? refreshedCredentials;
      items.push(planned.item);
      if (planned.job) jobs.push(planned.job);
    }

    const commit: CalendarScanCommit = {
      runId: run.id,
      claimToken,
      expectedCursor,
      nextCursor: page.nextCursor ?? expectedCursor,
      scanComplete: false,
      items,
      jobs,
      nowIso: input.nowIso,
    };
    const committed = await deps.repository.commitScanPage(actor, commit);
    if (!committed.ok || !committed.value) {
      return {
        ok: false,
        message: "The Calendar sync scan page could not be saved.",
        retryable: true,
      };
    }

    const refreshed = await deps.repository.getRun(actor, run.id);
    if (!refreshed.ok || !refreshed.value) {
      return { ok: false, message: "Unable to refresh the Calendar sync run." };
    }
    run = refreshed.value;
    tasksExhausted = page.complete;
  }

  // Remove managed events whose task row no longer exists. Orphan cleanup runs
  // only after the task scan has completed, so a not-yet-scanned page can never
  // be mistaken for a deleted task.
  while (!run.scanComplete && tasksExhausted && Date.now() < input.deadline) {
    const claimToken = randomUUID();
    const claimed = await deps.repository.claimScan(actor, {
      runId: run.id,
      claimToken,
      nowIso: input.nowIso,
      leaseSeconds: config.leaseSeconds,
    });
    if (!claimed.ok) {
      return {
        ok: false,
        message: "Unable to claim the Calendar sync scan.",
        persistenceFailure: true,
      };
    }
    if (!claimed.value) break;
    run = claimed.value;
    const expectedCursor = run.scanCursorCreatedAt && run.scanCursorTaskId
      ? { createdAt: run.scanCursorCreatedAt, taskId: run.scanCursorTaskId }
      : null;

    const orphans = await deps.repository.listOrphanMappings(actor, {
      ownerUserId: run.ownerUserId,
      destinationKey: run.destination.destinationKey,
      limit: config.scanPageSize,
    });
    if (!orphans.ok) {
      return { ok: false, message: "Unable to load orphaned Calendar mappings.", retryable: true };
    }
    if (orphans.value.length === 0) {
      const completed = await deps.repository.commitScanPage(actor, {
        runId: run.id,
        claimToken,
        expectedCursor,
        nextCursor: expectedCursor,
        scanComplete: true,
        items: [],
        jobs: [],
        nowIso: input.nowIso,
      });
      if (!completed.ok || !completed.value) {
        return { ok: false, message: "Unable to finish the Calendar scan.", retryable: true };
      }
      run = { ...run, scanComplete: true };
      break;
    }

    const jobs: CalendarScanJobDraft[] = [];
    const items: CalendarRunItemDraft[] = [];
    for (const orphan of orphans.value) {
      // The mapping stays active until Google confirms the delete and the job
      // completion settles atomically. If this page never commits, the next
      // pass sees the same orphan instead of a removed mapping hiding a live
      // Google event. The listing only excludes mappings that already have
      // active queued work, so this loop still terminates.
      items.push({
        taskId: orphan.taskId,
        outcome: "pending",
        exclusionReason: null,
        eventId: null,
        payloadHash: null,
        errorMessage: null,
      });
      jobs.push({
        taskId: orphan.taskId,
        operation: "delete",
        eventId: orphan.eventId,
        generation: orphan.generation,
        eventExists: true,
        payloadHash: null,
        exclusionReason: null,
        taskUpdatedAt: input.nowIso,
      });
    }

    const committed = await deps.repository.commitScanPage(actor, {
      runId: run.id,
      claimToken,
      expectedCursor,
      nextCursor: expectedCursor,
      scanComplete: false,
      items,
      jobs,
      nowIso: input.nowIso,
    });
    if (!committed.ok || !committed.value) break;
  }

  return { ok: true, run, refreshedCredentials };
}

function jobMatchesConnection(
  job: CalendarJobRecord,
  connection: CalendarConnectionRecord,
) {
  return (
    isVerifiedCalendarDestination(job.destination) &&
    sameVerifiedCalendarDestination(
      job.destination,
      destinationOfConnection(connection),
    )
  );
}

async function completeJobOutcome(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  input: {
    job: CalendarJobRecord;
    outcome: "created" | "updated" | "removed" | "unchanged" | "excluded";
    eventId: string | null;
    payloadHash: string | null;
    generation: number;
    exclusionReason: CalendarScanJobDraft["exclusionReason"];
    mappingRemoval?: { eventId: string; generation: number } | null;
    nowIso: string;
    lastError?: string | null;
  },
) {
  return deps.repository.completeJob(actor, {
    job: input.job,
    claimToken: input.job.claimToken as string,
    completion: {
      outcome: input.outcome,
      eventId: input.eventId,
      generation: input.generation,
      payloadHash: input.payloadHash,
      exclusionReason: input.exclusionReason,
      mappingRemoval: input.mappingRemoval ?? null,
      lastError: input.lastError ?? null,
    },
    nowIso: input.nowIso,
  });

}

async function failJob(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  input: {
    job: CalendarJobRecord;
    message: string;
    permanent: boolean;
    retryAfterSeconds?: number;
    nowIso: string;
    now: Date;
    exclusionReason?: CalendarScanJobDraft["exclusionReason"];
    outcome?: "failed" | "excluded";
  },
) {
  const attempts = input.job.attempts;
  const exhausted = attempts >= CALENDAR_SYNC_MAX_ATTEMPTS;
  const terminal = input.permanent || exhausted;
  const retryAt = terminal
    ? null
    : nextCalendarRetryAtIso({
        jobId: input.job.id,
        attempts,
        now: getNow(deps),
        retryAfterSeconds: input.retryAfterSeconds,
      });

  const failed = await deps.repository.failJob(actor, {
    job: input.job,
    claimToken: input.job.claimToken as string,
    failure: {
      message: exhausted
        ? `${input.message} Retry limit reached.`
        : input.message,
      permanent: input.permanent,
      retryAt,
      outcome: input.outcome ?? "failed",
      exclusionReason: input.exclusionReason ?? null,
    },
    nowIso: input.nowIso,
  });

  return failed.ok && failed.value;
}

async function claimStillCurrent(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  job: CalendarJobRecord,
): Promise<{ ok: boolean; current: boolean }> {
  if (!job.claimToken) return { ok: true, current: false };
  const result = await deps.repository.isJobClaimCurrent(
    actor,
    job.id,
    job.claimToken,
  );
  if (!result.ok) return { ok: false, current: false };
  return { ok: true, current: result.value };
}

async function processJob(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  input: {
    job: CalendarJobRecord;
    connection: CalendarConnectionRecord;
    nowIso: string;
    now: Date;
  },
): Promise<{
  refreshedCredentials?: RefreshedCalendarCredentials;
  authFailure?: boolean;
  staleAuth?: boolean;
  persistenceError?: string;
  settlementFailed?: boolean;
}> {
  const { job, connection, nowIso, now } = input;
  const config = getConfig(deps);

  if (!jobMatchesConnection(job, connection)) {
    const _failRecorded9 = await failJob(actor, deps, {
      job,
      message:
        "The Calendar destination changed after this job was queued. Its events remain in the previous calendar.",
      permanent: true,
      nowIso,
      now,
    });
    if (!_failRecorded9) {
      return { persistenceError: "Unable to record the Calendar sync failure." };
    }
    return {};
  }

  const taskResult = await deps.repository.getTask(actor, {
    ownerUserId: job.ownerUserId,
    taskId: job.taskId,
  });
  if (!taskResult.ok) {
    const _failRecorded8 = await failJob(actor, deps, {
      job,
      message: "Unable to load the task for Calendar sync.",
      permanent: false,
      nowIso,
      now,
    });
    if (!_failRecorded8) {
      return { persistenceError: "Unable to record the Calendar sync failure." };
    }
    return {};
  }

  const task = taskResult.value;
  let refreshedCredentials:
    | RefreshedCalendarCredentials
    | undefined;

  const plannedEventId = deterministicCalendarEventId({
    ownerUserId: job.ownerUserId,
    taskId: job.taskId,
    destinationKey: job.destination.destinationKey,
    generation: job.generation,
  });
  const built = task
    ? buildCalendarEventPayload({
        ownerUserId: task.ownerUserId,
        task,
        destination: job.destination,
        generation: job.generation,
        eventId: job.eventId ?? plannedEventId,
        linkBaseUrl: config.linkBaseUrl,
        timeZone: connection.timeZone,
      })
    : null;

  if (!task || built?.plan.kind === "excluded") {
    const exclusionReason = built?.plan.kind === "excluded"
      ? built.plan.exclusionReason
      : job.exclusionReason;
    let eventId = job.eventExists ? job.eventId : null;
    let removalGeneration = job.generation;
    // A verified target survives claim recovery in the destination mapping,
    // even if Google has already deleted it and a newer edit replaced the job.
    const mappings = await deps.repository.loadMappingsForTasks(actor, {
      ownerUserId: job.ownerUserId, taskIds: [job.taskId],
    });
    if (!mappings.ok) {
      const _failRecorded7 = await failJob(actor, deps, {
        job, message: "Unable to load the Calendar removal target.",
        permanent: false, nowIso, now,
      });
      if (!_failRecorded7) {
        return { persistenceError: "Unable to record the Calendar sync failure." };
      }
      return {};
    }
    const mapped = mappings.value.find((mapping) =>
      mapping.destination.destinationKey === job.destination.destinationKey &&
      mapping.status === "active" && mapping.metadataVerified &&
      (mapping.generation === job.generation ||
        ((!task || built?.plan.kind === "excluded") && mapping.generation > job.generation)),
    );
    if (mapped && (!eventId || mapped.generation > job.generation)) {
      eventId = mapped.eventId;
      removalGeneration = mapped.generation;
    }
    // An insert may have reached Google before its local settlement failed.
    // For a planned ID without a mapping, verify ownership before deleting it.
    if (!eventId && (job.eventId === plannedEventId ||
      (job.eventId === null && job.operation === "upsert"))) {
      const lookup = await deps.provider.getEvent(connection, plannedEventId);
      if (!lookup.ok) {
        if (lookup.error.kind === "authorization") {
          const paused = await pauseForAuthorization(actor, deps, {
            runId: job.runId, connection, message: lookup.error.message, nowIso,
          });
          if (!paused.ok) {
            return { persistenceError: paused.message };
          }
          return { authFailure: true, staleAuth: !paused.applied };
        }
        const _failRecorded6 = await failJob(actor, deps, {
          job, message: lookup.error.message, permanent: lookup.error.kind === "permanent",
          retryAfterSeconds: lookup.error.retryAfterSeconds, nowIso, now,
        });
        if (!_failRecorded6) {
          return { persistenceError: "Unable to record the Calendar sync failure." };
        }
        return {};
      }
      refreshedCredentials = lookup.refreshedCredentials;
      const metadata = lookup.value?.privateProperties;
      if (lookup.value?.status !== "cancelled" &&
          metadata?.source === "ega-house" &&
          metadata.task_id === job.taskId &&
          metadata.owner_user_id === job.ownerUserId &&
          metadata.destination_key === job.destination.destinationKey &&
          metadata.generation === String(job.generation)) {
        if (!job.claimToken) return { refreshedCredentials };
        const prepared = await deps.repository.prepareJobRemoval(actor, {
          jobId: job.id, claimToken: job.claimToken, eventId: plannedEventId, nowIso,
        });
        if (!prepared.ok) {
          const _failRecorded5 = await failJob(actor, deps, {
            job, message: "Unable to save the verified Calendar removal target.",
            permanent: false, nowIso, now,
          });
          if (!_failRecorded5) {
            return { persistenceError: "Unable to record the Calendar sync failure." };
          }
          return { refreshedCredentials };
        }
        if (!prepared.value) return {
          refreshedCredentials,
          persistenceError: "Unable to save the Calendar removal target because its claim expired or was superseded.",
          settlementFailed: true,
        };
        eventId = plannedEventId;
      }
    }

    if (eventId) {
      const _claim1 = await claimStillCurrent(actor, deps, job);
      if (!_claim1.ok) return { persistenceError: "Unable to verify the job claim." };
      if (!_claim1.current) return { persistenceError: "Unable to verify the job claim because it expired or was superseded.", settlementFailed: true };
      const deleted = await deps.provider.deleteEvent(connection, eventId);
      if (!deleted.ok) {
        if (deleted.error.kind === "authorization") {
          const paused = await pauseForAuthorization(actor, deps, {
            runId: job.runId, connection, message: deleted.error.message, nowIso,
          });
          if (!paused.ok) {
            return { persistenceError: paused.message, refreshedCredentials };
          }
          return {
            authFailure: true,
            staleAuth: !paused.applied,
            refreshedCredentials,
          };
        }
        const _failRecorded4 = await failJob(actor, deps, {
          job, message: deleted.error.message, permanent: deleted.error.kind === "permanent",
          retryAfterSeconds: deleted.error.retryAfterSeconds, nowIso, now,
        });
        if (!_failRecorded4) {
          return { persistenceError: "Unable to record the Calendar sync failure." };
        }
        return { refreshedCredentials };
      }
      refreshedCredentials = deleted.refreshedCredentials ?? refreshedCredentials;

      if (deleted.value.alreadyRemoved) {
        const accessible = await deps.provider.isCalendarAccessible(connection);
        if (!accessible.ok) {
          const _failRecorded3 = await failJob(actor, deps, {
            job,
            message: accessible.error.message,
            permanent: false,
            retryAfterSeconds: accessible.error.retryAfterSeconds,
            nowIso,
            now,
          });
          if (!_failRecorded3) {
            return { persistenceError: "Unable to record the Calendar sync failure." };
          }
          return { refreshedCredentials };
        }
        if (!accessible.value) {
          const paused = await pauseForAuthorization(actor, deps, {
            runId: job.runId,
            connection,
            message: "Google Calendar is inaccessible. Reconnect and retry.",
            nowIso,
          });
          if (!paused.ok) {
            return { persistenceError: paused.message, refreshedCredentials };
          }
          return {
            authFailure: true,
            staleAuth: !paused.applied,
            refreshedCredentials,
          };
        }
      }
    }

    const settled = await completeJobOutcome(actor, deps, {
      job, outcome: eventId ? "removed" : "excluded",
      eventId: null, payloadHash: null, generation: removalGeneration, exclusionReason,
      mappingRemoval: eventId ? { eventId, generation: removalGeneration } : null,
      nowIso,
    });
    if (!settled.ok || !settled.value) {
      return {
        persistenceError: !settled.ok
          ? "Unable to settle the Calendar sync job."
          : "Unable to settle the Calendar sync job because its claim expired or was superseded.",
        settlementFailed: true,
      };
    }
    return { refreshedCredentials };
  }

  if (!built?.payload) {
    const _failRecorded2 = await failJob(actor, deps, {
      job,
      message: "The Calendar event payload could not be built.",
      permanent: true,
      nowIso,
      now,
    });
    if (!_failRecorded2) {
      return { persistenceError: "Unable to record the Calendar sync failure." };
    }
    return {};
  }

  const mappings = await deps.repository.loadMappingsForTasks(actor, {
    ownerUserId: job.ownerUserId,
    taskIds: [job.taskId],
  });
  if (!mappings.ok) {
    const _failRecorded1 = await failJob(actor, deps, {
      job, message: "Unable to load Calendar event mappings.",
      permanent: false, nowIso, now,
    });
    if (!_failRecorded1) {
      return { persistenceError: "Unable to record the Calendar sync failure." };
    }
    return {};
  }

  const mapping = pickMappings(mappings.value, job.destination.destinationKey).get(job.taskId)?.latest;
  let generation = job.generation;
  const { payloadHash } = built;
  let payload = built.payload;
  let updating = Boolean(job.eventExists && job.eventId);

  function targetEvent(eventId: string, nextGeneration: number) {
    generation = nextGeneration;
    payload = {
      ...payload,
      eventId,
      privateProperties: { ...payload.privateProperties, generation: String(generation) },
    };
  }

  async function rotateEvent(nextGeneration: number) {
    if (!job.claimToken) return { ok: false, dbFailed: false };
    const eventId = deterministicCalendarEventId({
      ownerUserId: job.ownerUserId,
      taskId: job.taskId,
      destinationKey: job.destination.destinationKey,
      generation: nextGeneration,
    });
    const advanced = await deps.repository.advanceJobGeneration(actor, {
      jobId: job.id,
      claimToken: job.claimToken,
      generation: nextGeneration,
      eventId,
      payloadHash,
      nowIso,
    });
    if (!advanced.ok) {
      return { ok: false, dbFailed: true };
    }
    if (!advanced.value) {
      return { ok: false, dbFailed: false };
    }
    targetEvent(eventId, nextGeneration);
    updating = false;
    return { ok: true, dbFailed: false };
  }

  let needsMappingLookup = false;
  if (mapping && mapping.generation >= generation) {
    if (mapping.status === "removed") {
      const _rotA = await rotateEvent(mapping.generation + 1);
      if (_rotA.dbFailed) return { persistenceError: "Unable to advance the Calendar job generation." };
      if (!_rotA.ok) return { persistenceError: "Unable to advance the Calendar job generation because its claim expired or was superseded.", settlementFailed: true };
    } else {
      needsMappingLookup = !updating || job.eventId !== mapping.eventId;
      targetEvent(mapping.eventId, mapping.generation);
      updating = true;
    }
  }

  let lookupFailure: CalendarProviderFailure | undefined;
  if (needsMappingLookup) {
    const existing = await deps.provider.getEvent(connection, payload.eventId);
    if (!existing.ok) {
      lookupFailure = existing.error;
    } else if (!existing.value || existing.value.status === "cancelled") {
      const accessible = await deps.provider.isCalendarAccessible(connection);
      if (!accessible.ok || !accessible.value) {
        if (!accessible.ok) {
          const _recorded = await failJob(actor, deps, {
            job,
            message: accessible.error.message,
            permanent: false,
            nowIso,
            now: getNow(deps),
          });
          if (!_recorded) {
            return { persistenceError: "Unable to record the Calendar sync failure." };
          }
        } else {
          const paused = await pauseForAuthorization(actor, deps, {
            runId: job.runId,
            connection,
            message: "Google Calendar is inaccessible. Reconnect and retry.",
            nowIso,
          });
          if (!paused.ok) {
            return { persistenceError: paused.message, refreshedCredentials };
          }
          return {
            authFailure: true,
            staleAuth: !paused.applied,
            refreshedCredentials,
          };
        }
        return { refreshedCredentials };
      }
      const _rotB = await rotateEvent(generation + 1);
      if (_rotB.dbFailed) return { persistenceError: "Unable to advance the Calendar job generation." };
      if (!_rotB.ok) return { persistenceError: "Unable to advance the Calendar job generation because its claim expired or was superseded.", settlementFailed: true };
    }
  }

  const _claim2 = await claimStillCurrent(actor, deps, job);
  if (!_claim2.ok) return { persistenceError: "Unable to verify the job claim." };
  if (!_claim2.current) return { persistenceError: "Unable to verify the job claim because it expired or was superseded.", settlementFailed: true };

  let writeResult = lookupFailure
    ? { ok: false as const, error: lookupFailure }
    : updating
      ? await deps.provider.updateEvent(connection, payload.eventId, payload)
      : await deps.provider.createEvent(connection, payload);

  if (!writeResult.ok && writeResult.error.kind === "not_found" && updating) {
    const accessible = await deps.provider.isCalendarAccessible(connection);
    if (!accessible.ok || !accessible.value) {
      if (!accessible.ok) {
        const recorded = await failJob(actor, deps, {
          job,
          message: accessible.error.message,
          permanent: false,
          retryAfterSeconds: accessible.error.retryAfterSeconds,
          nowIso,
          now: getNow(deps),
        });
        if (!recorded) return { persistenceError: "Unable to record the Calendar sync failure." };
      } else {
        const paused = await pauseForAuthorization(actor, deps, {
          runId: job.runId,
          connection,
          message: "Google Calendar is inaccessible. Reconnect and retry.",
          nowIso,
        });
        if (!paused.ok) {
          return { persistenceError: paused.message, refreshedCredentials };
        }
        return {
          authFailure: true,
          staleAuth: !paused.applied,
          refreshedCredentials,
        };
      }
      return { refreshedCredentials };
    }
    const _rotC = await rotateEvent(generation + 1);
    if (_rotC.dbFailed) return { persistenceError: "Unable to advance the Calendar job generation." };
    if (!_rotC.ok) return { persistenceError: "Unable to advance the Calendar job generation because its claim expired or was superseded.", settlementFailed: true };
    writeResult = await deps.provider.createEvent(connection, payload);
  }
  if (!writeResult.ok && writeResult.error.kind === "conflict") {
    const existing = await deps.provider.getEvent(connection, payload.eventId);
    if (!existing.ok) {
      writeResult = existing;
    } else if (existing.value) {
      const privateProperties = existing.value.privateProperties;
      const metadataMatches =
        privateProperties.source === "ega-house" &&
        privateProperties.task_id === task.id &&
        privateProperties.owner_user_id === task.ownerUserId &&
        privateProperties.destination_key === job.destination.destinationKey;
      if (existing.value.status === "cancelled" &&
          (metadataMatches || mapping?.eventId === existing.value.id)) {
        const existingGeneration = Number(privateProperties.generation);
        const verifiedGeneration = metadataMatches && Number.isSafeInteger(existingGeneration)
          ? existingGeneration
          : 0;
        const _rotD = await rotateEvent(Math.max(generation, verifiedGeneration, mapping?.generation ?? 0) + 1);
        if (_rotD.dbFailed) return { persistenceError: "Unable to advance the Calendar job generation." };
        if (!_rotD.ok) return { persistenceError: "Unable to advance the Calendar job generation because its claim expired or was superseded.", settlementFailed: true };
        writeResult = await deps.provider.createEvent(connection, payload);
      } else if (metadataMatches && existing.value.status !== "cancelled") {
        const _claim2 = await claimStillCurrent(actor, deps, job);
  if (!_claim2.ok) return { persistenceError: "Unable to verify the job claim." };
  if (!_claim2.current) return { persistenceError: "Unable to verify the job claim because it expired or was superseded.", settlementFailed: true };
        writeResult = await deps.provider.updateEvent(connection, payload.eventId, payload);
      } else {
        writeResult = {
          ok: false,
          error: {
            kind: "permanent",
            message: "A Google Calendar event with the deterministic id already exists for a different task or calendar. It was left untouched.",
          },
        };
      }
    }
  }

  if (!writeResult.ok) {
    if (writeResult.error.kind === "authorization") {
      const paused = await pauseForAuthorization(actor, deps, {
        runId: job.runId,
        connection,
        message: writeResult.error.message,
        nowIso,
      });
      if (!paused.ok) {
        return { persistenceError: paused.message };
      }
      return { authFailure: true, staleAuth: !paused.applied };
    }

    const _failRecorded0 = await failJob(actor, deps, {
      job,
      message: writeResult.error.message,
      permanent: writeResult.error.kind === "permanent",
      retryAfterSeconds: writeResult.error.retryAfterSeconds,
      nowIso,
      now,
    });
    if (!_failRecorded0) {
      return { persistenceError: "Unable to record the Calendar sync failure." };
    }
    return {};
  }

  refreshedCredentials = writeResult.refreshedCredentials;
  const eventId = writeResult.value.id;
  const _claim4 = await claimStillCurrent(actor, deps, job);
  if (!_claim4.ok || !_claim4.current) {
    return { persistenceError: "Unable to settle the Calendar sync job because its claim expired or was superseded.", settlementFailed: true };
  }
  const settled = await completeJobOutcome(actor, deps, {
    job,
    outcome: updating ? "updated" : "created",
    eventId,
    payloadHash,
    generation,
    exclusionReason: null,
    nowIso,
  });
  if (!settled.ok || !settled.value) {
    return {
      persistenceError: !settled.ok
          ? "Unable to settle the Calendar sync job."
          : "Unable to settle the Calendar sync job because its claim expired or was superseded.",
      settlementFailed: true,
    };
  }

  return { refreshedCredentials };
}

async function persistRefreshedCredentials(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  input: {
    connection: CalendarConnectionRecord;
    refreshed: RefreshedCalendarCredentials;
    nowIso: string;
  },
) {
  if (!input.refreshed.accessTokenEncrypted) return input.connection;
  const saved = await deps.repository.updateConnectionCredentials(actor, {
    ownerUserId: input.connection.ownerUserId,
    expectedUpdatedAt: input.connection.updatedAt,
    credentials: input.refreshed,
    nowIso: input.nowIso,
  });
  if (!saved.ok || !saved.value) return input.connection;
  return {
    ...input.connection,
    ...input.refreshed,
    refreshTokenEncrypted: input.refreshed.refreshTokenEncrypted === undefined
      ? input.connection.refreshTokenEncrypted
      : input.refreshed.refreshTokenEncrypted,
    updatedAt: input.nowIso,
  };
}

async function drainRunJobs(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  input: {
    run: CalendarRunRecord;
    connection: CalendarConnectionRecord;
    deadline: number;
    nowIso: string;
    now: Date;
  },
): Promise<{
  authFailure?: boolean;
  staleAuth?: boolean;
  persistenceError?: string;
  refreshed?: RefreshedCalendarCredentials;
  processed?: number;
}> {
  const config = getConfig(deps);
  let processed = 0;
  let refreshed:
    | RefreshedCalendarCredentials
    | undefined;

  while (processed < config.jobLimit && Date.now() < input.deadline) {
    const claimToken = randomUUID();
    const remaining = Math.min(
      config.jobLimit - processed,
      Math.max(1, Math.ceil((input.deadline - Date.now()) / 2_000)),
    );
    const claimed = await deps.repository.claimJobs(actor, {
      ownerUserId: input.run.ownerUserId,
      runId: input.run.id,
      destinationKey: input.run.destination.destinationKey,
      claimToken,
      limit: remaining,
      nowIso: input.nowIso,
      leaseSeconds: config.leaseSeconds,
    });

    if (!claimed.ok) {
      return {
        persistenceError: "Unable to claim Calendar sync jobs.",
        refreshed,
        processed,
      };
    }
    if (claimed.value.length === 0) break;

    const jobs = claimed.value;
    let nextJob = 0;
    try {
      while (nextJob < jobs.length && Date.now() < input.deadline) {
        const job = jobs[nextJob++];
        const result = await processJob(actor, deps, {
          job,
          connection: input.connection,
          nowIso: input.nowIso,
          now: input.now,
        });
        refreshed = result.refreshedCredentials ?? refreshed;
        if (result.persistenceError) {
          if (result.settlementFailed) {
            // Keep the failed job claimed (processing) so it is not counted as
            // processed; release only the not-yet-started jobs in this batch.
            const remainingIds = jobs.slice(nextJob).map((job) => job.id);
            if (remainingIds.length > 0) {
              await deps.repository.releaseJobs(actor, {
                jobIds: remainingIds,
                claimToken,
                nowIso: input.nowIso,
              }).catch(() => undefined);
            }
            nextJob = jobs.length;
            return { persistenceError: result.persistenceError, refreshed, processed };
          }
          nextJob -= 1;
          return { persistenceError: result.persistenceError, refreshed };
        }
        if (result.authFailure) {
          nextJob -= 1;
          return { authFailure: true, staleAuth: result.staleAuth, refreshed, processed };
        }
        processed += 1;
      }
    } finally {
      if (nextJob < jobs.length) {
        await deps.repository.releaseJobs(actor, {
          jobIds: jobs.slice(nextJob).map((job) => job.id),
          claimToken,
          nowIso: input.nowIso,
        }).catch(() => undefined);
      }
    }
  }

  return { refreshed, processed };
}

async function processRunBatch(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  run: CalendarRunRecord,
  requestDeadline?: number,
): Promise<CalendarSyncProcessResult> {
  const now = getNow(deps);
  const nowIso = now.toISOString();
  const config = getConfig(deps);
  const deadline = requestDeadline ?? Date.now() + config.requestBudgetMs;

  if (Date.now() >= deadline) {
    return {
      ok: true,
      status: await buildStatus(actor, deps, run.id),
      authFailure: false,
      retryable: true,
    };
  }

  const connectionResult = await deps.repository.getConnectionForOwner(
    actor,
    run.ownerUserId,
  );
  if (!connectionResult.ok) {
    return {
      ok: false,
      errorMessage: "Unable to load the Google Calendar connection.",
    };
  }
  if (!connectionResult.value) {
    return {
      ok: true,
      status: withStatusMessage(
        await buildStatus(actor, deps, run.id),
        "The Google Calendar connection is unavailable. Reconnect and retry.",
      ),
      authFailure: true,
      retryable: false,
    };
  }

  let connection = connectionResult.value;
  const destination = destinationOfConnection(connection);

  if (!isConnectionUsable(connection)) {
    const message =
      "Google Calendar needs to be reconnected before sync can continue.";
    const paused = await pauseForAuthorization(actor, deps, {
      runId: run.id,
      connection,
      message,
      nowIso,
    });
    if (!paused.ok) {
      return { ok: false, errorMessage: paused.message };
    }
    const currentStatus = await buildStatus(actor, deps, run.id);
    if (!paused.applied) {
      return {
        ok: true,
        status: currentStatus,
        authFailure: false,
        retryable: false,
      };
    }
    return {
      ok: true,
      status: withStatusMessage(currentStatus, message),
      authFailure: true,
      retryable: false,
    };
  }

  if (!isVerifiedCalendarDestination(destination)) {
    const message =
      "Google Calendar account identity could not be verified. Reconnect Google Calendar before sync can continue.";
    const paused = await pauseForAuthorization(actor, deps, {
      runId: run.id,
      connection,
      message,
      nowIso,
    });
    if (!paused.ok) {
      return { ok: false, errorMessage: paused.message };
    }
    const currentStatus = await buildStatus(actor, deps, run.id);
    if (!paused.applied) {
      return {
        ok: true,
        status: currentStatus,
        authFailure: false,
        retryable: false,
      };
    }
    return {
      ok: true,
      status: withStatusMessage(currentStatus, message),
      authFailure: true,
      retryable: false,
    };
  }

  if (!isVerifiedCalendarDestination(run.destination)) {
    const message =
      "This Calendar sync run predates verified account binding. Reconnect Google Calendar and start a new sync.";
    const paused = await deps.repository.pauseRun(actor, run.id, message, nowIso);
    if (!paused.ok) {
      return {
        ok: false,
        errorMessage: "Unable to save Calendar sync pause state.",
      };
    }
    return {
      ok: true,
      status: withStatusMessage(
        await buildStatus(actor, deps, run.id),
        message,
      ),
      authFailure: false,
      retryable: false,
    };
  }

  if (!sameVerifiedCalendarDestination(destination, run.destination)) {
    const paused = await deps.repository.pauseRun(
      actor,
      run.id,
      `The Calendar destination changed to ${destination.calendarId}. Events already published to ${run.destination.calendarId} remain there.`,
      nowIso,
    );
    if (!paused.ok) {
      return {
        ok: false,
        errorMessage: "Unable to save Calendar sync pause state.",
      };
    }
    return {
      ok: true,
      status: withStatusMessage(
        await buildStatus(actor, deps, run.id),
        `The Calendar destination changed. Events sent to ${run.destination.calendarId} remain there and were not moved.`,
      ),
      authFailure: false,
      retryable: false,
    };
  }

  if (listingBackedOff(run, getNow(deps))) {
    return {
      ok: true,
      status: withStatusMessage(
        await buildStatus(actor, deps, run.id),
        "Google Calendar asked us to wait before retrying. Synchronization will resume after the delay.",
      ),
      authFailure: false,
      retryable: true,
    };
  }

  let eventIndex = new Map<string, CalendarEventIndexEntry>();
  if (!run.scanComplete) {
    const observedCursor =
      run.scanCursorCreatedAt && run.scanCursorTaskId
        ? { createdAt: run.scanCursorCreatedAt, taskId: run.scanCursorTaskId }
        : null;
    const checkpoint = await deps.repository.getListingCheckpoint(actor, run.id);
    if (!checkpoint.ok) {
      return { ok: false, errorMessage: "Unable to load Calendar listing progress." };
    }
    const savedListing = checkpoint.value;
    const listing: CalendarProviderResult<{
      complete: boolean;
      nextPageToken?: string | null;
      events: CalendarEventIndexEntry[];
    }> = savedListing?.events && !savedListing.nextPageToken
      ? { ok: true as const, value: { complete: true, events: [] } }
      : await deps.provider.listManagedEvents(connection, deadline, savedListing?.nextPageToken);
    if (!listing.ok) {
      if (isAuthorizationFailure(listing.error)) {
        const paused = await pauseForAuthorization(actor, deps, {
          runId: run.id,
          connection,
          expectedListingCursor: observedCursor,
          expectedListingRevision: savedListing?.revision ?? 0,
          fenceListingPause: true,
          message: listing.error.message,
          nowIso,
        });
        if (!paused.ok) {
          return { ok: false, errorMessage: paused.message };
        }
        const currentStatus = await buildStatus(actor, deps, run.id);
        if (!paused.applied || !paused.runPaused) {
          return {
            ok: true,
            status: currentStatus,
            authFailure: paused.applied,
            retryable: false,
          };
        }
        return {
          ok: true,
          status: withStatusMessage(currentStatus, listing.error.message),
          authFailure: true,
          retryable: false,
        };
      }

      const terminalListingFailure =
        listing.error.kind === "permanent" ||
        listing.error.kind === "not_found";
      const retryMessage =
        "Google Calendar events could not be verified. No removals were attempted; retry to continue.";
      const recorded = await deps.repository.recordListingFailure(actor, {
        runId: run.id,
        expectedCursor: observedCursor,
        expectedListingRevision: savedListing?.revision ?? 0,
        pause: terminalListingFailure,
        retryAt: terminalListingFailure
          ? null
          : nextCalendarRetryAtIso({
              jobId: run.id,
              attempts: 1,
              now: getNow(deps),
              retryAfterSeconds: listing.error.retryAfterSeconds,
            }),
        message: terminalListingFailure
          ? listing.error.message
          : listing.error.message || retryMessage,
        nowIso,
      });
      if (!recorded.ok) {
        return {
          ok: false,
          errorMessage: "Unable to save Calendar listing failure state.",
        };
      }
      const currentStatus = await buildStatus(actor, deps, run.id);
      if (!recorded.value) {
        return {
          ok: true,
          status: currentStatus,
          authFailure: false,
          retryable: false,
        };
      }

      return {
        ok: true,
        status: withStatusMessage(
          currentStatus,
          terminalListingFailure ? listing.error.message : retryMessage,
        ),
        authFailure: false,
        retryable: !terminalListingFailure,
      };
    }

    if (listing.refreshedCredentials) {
      connection = await persistRefreshedCredentials(actor, deps, {
        connection,
        refreshed: listing.refreshedCredentials,
        nowIso,
      });
    }

    const events = [...(savedListing?.events ?? []), ...listing.value.events];
    if ((!savedListing?.events || savedListing.nextPageToken) &&
        (listing.value.complete || (listing.value.nextPageToken && listing.value.nextPageToken !== savedListing?.nextPageToken))) {
      const saved = await deps.repository.saveListingCheckpoint(actor, run.id, {
        revision: (savedListing?.revision ?? 0) + 1,
        nextPageToken: listing.value.nextPageToken ?? null,
        events,
      });
      if (!saved.ok) {
        return { ok: false, errorMessage: "Unable to save Calendar listing progress." };
      }
      if (!saved.value || !listing.value.complete) {
        return {
          ok: true,
          status: await buildStatus(actor, deps, run.id),
          authFailure: false,
          retryable: true,
        };
      }
    }

    if (!listing.value.complete) {
      // An incomplete event listing is not proof that any managed event was
      // deleted, so the scan intentionally refuses to infer removals.
      const incompleteMessage =
        "The Calendar event listing was incomplete. No removals were attempted; retry to continue.";
      const recorded = await deps.repository.recordListingFailure(actor, {
        runId: run.id,
        expectedCursor: observedCursor,
        expectedListingRevision: savedListing?.revision ?? 0,
        pause: false,
        retryAt: nextCalendarRetryAtIso({
          jobId: run.id,
          attempts: 1,
          now: getNow(deps),
        }),
        message: incompleteMessage,
        nowIso,
      });
      if (!recorded.ok) {
        return {
          ok: false,
          errorMessage: "Unable to save Calendar listing retry state.",
        };
      }
      const currentStatus = await buildStatus(actor, deps, run.id);
      if (!recorded.value) {
        return {
          ok: true,
          status: currentStatus,
          authFailure: false,
          retryable: false,
        };
      }
      return {
        ok: true,
        status: withStatusMessage(currentStatus, incompleteMessage),
        authFailure: false,
        retryable: true,
      };
    }

    eventIndex = eventIndexFor(events);
  }
  if (Date.now() >= deadline) {
    return {
      ok: true,
      status: await buildStatus(actor, deps, run.id),
      authFailure: false,
      retryable: true,
    };
  }
  const scanResult = await scanRun(actor, deps, {
    run,
    connection,
    eventIndex,
    deadline,
    nowIso,
  });

  if (!scanResult.ok) {
    if (scanResult.persistenceFailure) {
      return { ok: false, errorMessage: scanResult.message };
    }
    const currentStatus = await buildStatus(actor, deps, run.id);
    if (scanResult.staleAuth) {
      return {
        ok: true,
        status: currentStatus,
        authFailure: false,
        retryable: false,
      };
    }
    return {
      ok: true,
      status: withStatusMessage(currentStatus, scanResult.message),
      authFailure: Boolean(scanResult.authFailure),
      retryable: scanResult.retryable ?? false,
    };
  }

  if (scanResult.refreshedCredentials) {
    connection = await persistRefreshedCredentials(actor, deps, {
      connection,
      refreshed: scanResult.refreshedCredentials,
      nowIso,
    });
  }

  const drained = await drainRunJobs(actor, deps, {
    run: scanResult.run,
    connection,
    deadline,
    nowIso,
    now,
  });

  if (drained.refreshed) {
    await persistRefreshedCredentials(actor, deps, {
      connection,
      refreshed: drained.refreshed,
      nowIso,
    });
  }

  if (drained.persistenceError) {
    return { ok: false, errorMessage: drained.persistenceError };
  }

  const completedRun = await deps.repository.completeRunIfDrained(actor, {
    runId: run.id,
    nowIso,
  });
  if (!completedRun.ok) {
    return {
      ok: false,
      errorMessage: "Unable to finalize the Calendar sync run.",
    };
  }

  let status = await buildStatus(actor, deps, run.id);
  // If no job was claimable this pass, stop browser-driven continuation to
  // avoid a tight loop while another worker holds the lease.
  if ((drained.processed ?? 0) === 0 && status.run?.scanComplete) {
    status = { ...status, run: { ...status.run, hasMore: false } };
  }
  return {
    ok: true,
    status:
      drained.authFailure && !drained.staleAuth
        ? withStatusMessage(
            status,
            "Google Calendar authorization expired. Reconnect and retry.",
          )
        : status,
    authFailure: Boolean(drained.authFailure && !drained.staleAuth),
    retryable: false,
  };
}

function withStatusMessage(
  status: CalendarSyncStatusView,
  message: string,
  continuationBlocked = true,
): CalendarSyncStatusView {
  return { ...status, message, continuationBlocked };
}

async function buildStatus(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  runId?: string,
): Promise<CalendarSyncStatusView> {
  const connectionResult = await deps.repository.getConnection(actor);
  const connection = connectionResult.ok ? connectionResult.value : null;
  const destination = connection
    ? destinationOfConnection(connection)
    : normalizeCalendarDestination({
        accountSubject: null,
        accountEmail: null,
        calendarId: "primary",
      });

  const runResult = runId
    ? await deps.repository.getRun(actor, runId)
    : await deps.repository.getLatestRun(actor, destination.destinationKey);
  const run = await loadRunView(
    actor,
    deps,
    runResult.ok ? runResult.value : null,
  );
  const pausedRunResult = await deps.repository.getPausedRun(
    actor,
    destination.destinationKey,
  );
  const pausedRun = pausedRunResult.ok ? pausedRunResult.value : null;

  return {
    connection: connectionView(connection),
    run,
    pausedRun,
    message: statusMessageFor(run, pausedRun),
    continuationBlocked: false,
    statusErrors: {
      connection: connectionResult.ok
        ? null
        : "Unable to load the Calendar connection.",
      run: runResult.ok
        ? null
        : runId
          ? "Unable to load the Calendar sync run."
          : "Unable to load the latest Calendar sync run.",
      pausedRun: pausedRunResult.ok
        ? null
        : "Unable to load a paused Calendar sync run.",
    },
  };
}

export async function startCalendarSync(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  options?: { retryMode?: boolean },
): Promise<ApplicationResult<CalendarSyncStatusView>> {
  const actorError = requireActor(actor);
  if (actorError) return actorError;

  const connectionResult = await deps.repository.getConnection(actor);
  if (!connectionResult.ok) {
    return applicationFailure("Unable to load the Calendar connection.");
  }

  const connection = connectionResult.value;
  if (!connection || !connection.connectedAt || connection.disconnectedAt) {
    return applicationFailure(
      "Connect Google Calendar before synchronizing tasks.",
      "validation",
      "calendar_not_connected",
    );
  }

  const destination = destinationOfConnection(connection);
  if (!isVerifiedCalendarDestination(destination)) {
    return applicationFailure(
      "Reconnect Google Calendar so its Google account identity can be verified before synchronizing tasks.",
      "validation",
      "calendar_identity_unverified",
    );
  }

  const now = getNow(deps);
  const runResult = await deps.repository.ensureRun(actor, {
    destination,
    retryMode: Boolean(options?.retryMode),
    nowIso: now.toISOString(),
  });

  if (!runResult.ok) {
    return applicationFailure("Unable to start Calendar synchronization.");
  }

  if (!options?.retryMode && runResult.value.status === "completed") {
    // ensureRun creates a fresh run for a new manual cycle; this branch is
    // defensive for an adapter that returns the prior completed run.
  }

  const result = await processRunBatch(actor, deps, runResult.value);
  if (!result.ok) {
    return applicationFailure(result.errorMessage);
  }
  return applicationSuccess(result.status);
}

export async function continueCalendarSync(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  runId: string,
): Promise<ApplicationResult<CalendarSyncStatusView>> {
  const actorError = requireActor(actor);
  if (actorError) return actorError;

  const runResult = await deps.repository.getRun(actor, runId);
  if (!runResult.ok) {
    return applicationFailure("Unable to load the Calendar sync run.");
  }
  if (!runResult.value) {
    return applicationFailure("Calendar sync run was not found.", "notFound");
  }

  if (runResult.value.status !== "active") {
    return applicationSuccess(await buildStatus(actor, deps, runId));
  }

  const result = await processRunBatch(actor, deps, runResult.value);
  if (!result.ok) {
    return applicationFailure(result.errorMessage);
  }
  return applicationSuccess(result.status);
}

export async function retryCalendarSync(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
): Promise<ApplicationResult<CalendarSyncStatusView>> {
  return startCalendarSync(actor, deps, { retryMode: true });
}

export async function processCalendarRecovery(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  options?: { runLimit?: number; destinationLimit?: number },
): Promise<
  ApplicationResult<{
    runsProcessed: number;
    destinationsProcessed: number;
    jobsProcessed: number;
  }>
> {
  const config = getConfig(deps);
  const now = getNow(deps);
  const nowIso = now.toISOString();
  const deadline = Date.now() + config.requestBudgetMs;
  const runs = await deps.repository.listActiveRuns(actor, options?.runLimit ?? 5);
  if (!runs.ok) {
    return applicationFailure("Unable to load active Calendar sync runs.");
  }

  let runsProcessed = 0;
  let recoveryErrorMessage: string | null = null;
  for (const run of runs.value) {
    if (Date.now() >= deadline) break;
    const batch = await processRunBatch(actor, deps, run, deadline);
    if (!batch.ok) {
      recoveryErrorMessage ??= batch.errorMessage;
      continue;
    }
    runsProcessed += 1;
  }

  const destinations = await deps.repository.listReadyDestinations(
    actor,
    options?.destinationLimit ?? 5,
  );
  if (!destinations.ok) {
    return applicationFailure("Unable to load ready Calendar sync destinations.");
  }

  let destinationsProcessed = 0;
  let jobsProcessed = 0;
  for (const queue of destinations.value) {
    if (Date.now() >= deadline) break;
    // A destination whose account or calendar cannot be verified is left
    // pending for a later recovery pass instead of being written through the
    // currently connected account.
    if (!isVerifiedCalendarDestination(queue.destination)) continue;

    const connection = await deps.repository.getConnectionForOwner(
      actor,
      queue.ownerUserId,
    );
    if (!connection.ok) {
      recoveryErrorMessage ??= "Unable to load the Google Calendar connection.";
      continue;
    }
    if (!connection.value || !isConnectionUsable(connection.value)) {
      continue;
    }

    const connectionDestination = destinationOfConnection(connection.value);
    if (
      !isVerifiedCalendarDestination(connectionDestination) ||
      !sameVerifiedCalendarDestination(
        queue.destination,
        connectionDestination,
      )
    ) {
      continue;
    }

    const claimToken = randomUUID();
    const claimed = await deps.repository.claimJobs(actor, {
      ownerUserId: queue.ownerUserId,
      runId: null,
      destinationKey: queue.destination.destinationKey,
      claimToken,
      limit: config.jobLimit,
      nowIso,
      leaseSeconds: config.leaseSeconds,
    });
    if (!claimed.ok) {
      recoveryErrorMessage ??= "Unable to claim Calendar sync jobs.";
      continue;
    }
    if (claimed.value.length === 0) continue;

    let refreshed:
      | RefreshedCalendarCredentials
      | undefined;
    let destinationFailed = false;
    const jobs = claimed.value;
    let nextJob = 0;
    try {
      while (nextJob < jobs.length && Date.now() < deadline) {
        const job = jobs[nextJob++];
        const result = await processJob(actor, deps, {
          job,
          connection: connection.value,
          nowIso,
          now,
        });
        refreshed = result.refreshedCredentials ?? refreshed;
        if (result.persistenceError) {
          if (result.settlementFailed) {
            const remainingIds = jobs.slice(nextJob).map((job) => job.id);
            if (remainingIds.length > 0) {
              await deps.repository.releaseJobs(actor, {
                jobIds: remainingIds,
                claimToken,
                nowIso,
              }).catch(() => undefined);
            }
            nextJob = jobs.length;
          } else {
            nextJob -= 1;
          }
          destinationFailed = true;
          recoveryErrorMessage ??= result.persistenceError;
          break;
        }
        if (result.authFailure) {
          nextJob -= 1;
          break;
        }
        jobsProcessed += 1;
      }
    } finally {
      if (nextJob < jobs.length) {
        await deps.repository.releaseJobs(actor, {
          jobIds: jobs.slice(nextJob).map((job) => job.id),
          claimToken,
          nowIso,
        }).catch(() => undefined);
      }
    }
    if (refreshed) {
      await persistRefreshedCredentials(actor, deps, {
        connection: connection.value,
        refreshed,
        nowIso,
      });
    }
    if (!destinationFailed) {
      destinationsProcessed += 1;
    }
  }

  if (recoveryErrorMessage) {
    return applicationFailure(recoveryErrorMessage);
  }

  return applicationSuccess({
    runsProcessed,
    destinationsProcessed,
    jobsProcessed,
  });
}
