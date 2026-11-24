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

export type CalendarSyncRunView = Readonly<{
  id: string;
  status: CalendarRunRecord["status"];
  retryMode: boolean;
  scanComplete: boolean;
  counts: CalendarRunCounts;
  exclusions: CalendarRunExclusionCount[];
  failures: CalendarRunFailure[];
  hasMore: boolean;
  lastError: string | null;
  startedAt: string;
  completedAt: string | null;
}>;

export type CalendarSyncStatusView = Readonly<{
  connection: CalendarSyncConnectionView;
  run: CalendarSyncRunView | null;
  pausedRun: CalendarRunRecord | null;
  message: string | null;
  continuationBlocked: boolean;
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

const EMPTY_COUNTS: CalendarRunCounts = Object.freeze({
  total: 0,
  created: 0,
  updated: 0,
  removed: 0,
  unchanged: 0,
  excluded: 0,
  failed: 0,
  pending: 0,
  retrying: 0,
  processing: 0,
  ready: 0,
});

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

  const safeCounts = counts.ok ? counts.value : EMPTY_COUNTS;
  const hasMore =
    run.status === "active" &&
    (!run.scanComplete || safeCounts.ready > 0);

  return {
    id: run.id,
    status: run.status,
    retryMode: run.retryMode,
    scanComplete: run.scanComplete,
    counts: safeCounts,
    exclusions: exclusions.ok ? exclusions.value : [],
    failures: failures.ok ? failures.value : [],
    hasMore,
    lastError: run.lastError,
    startedAt: run.createdAt,
    completedAt: run.completedAt,
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

  const latestRunResult = await deps.repository.getLatestRun(
    actor,
    destination.destinationKey,
  );
  const latestRun = latestRunResult.ok ? latestRunResult.value : null;
  const pausedRunResult = await deps.repository.getPausedRun(
    actor,
    destination.destinationKey,
  );
  const pausedRun = pausedRunResult.ok ? pausedRunResult.value : null;
  const run = await loadRunView(actor, deps, latestRun);

  return applicationSuccess({
    connection: connectionView(connection),
    run,
    pausedRun,
    message:
      run?.status === "paused" && run.lastError
        ? run.lastError
        : pausedRun
          ? `Sync for ${pausedRun.destination.calendarId} is paused. Events already published there remain in that calendar.`
          : null,
    continuationBlocked: false,
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
        await deps.repository.commitScanPage(actor, {
          runId: run.id,
          claimToken,
          expectedCursor,
          nextCursor: expectedCursor,
          scanComplete: false,
          items: [],
          jobs: [],
          nowIso: input.nowIso,
        });
        const authFailure = planned.lookupFailure.kind === "authorization";
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
    connection: CalendarConnectionRecord;
    outcome: "created" | "updated" | "removed" | "unchanged" | "excluded";
    eventId: string | null;
    payloadHash: string | null;
    generation: number;
    exclusionReason: CalendarScanJobDraft["exclusionReason"];
    mappingRemoval?: { eventId: string; generation: number } | null;
    nowIso: string;
    taskSyncStatus: "synced" | "failed" | "skipped";
    lastError?: string | null;
  },
) {
  const completed = await deps.repository.completeJob(actor, {
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
      taskSyncStatus: input.taskSyncStatus,
      taskFailureReason: input.lastError ?? null,
    },
    nowIso: input.nowIso,
  });

  if (!completed.ok || !completed.value) {
    // Another worker reclaimed this lease. Do not mutate mappings, run items or
    // task state from an expired claim; the settlement is atomic in the
    // repository and leaves the mapping active for the newer claim.
    return false;
  }

  const task = await deps.repository.getTask(actor, {
    ownerUserId: input.job.ownerUserId,
    taskId: input.job.taskId,
  });
  if (task.ok && task.value) {
    await deps.repository.updateTaskSyncState(actor, {
      taskId: input.job.taskId,
      eventId: input.eventId,
      status: input.taskSyncStatus,
      failureReason: input.lastError ?? null,
      nowIso: input.nowIso,
    });
  }

  return true;
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
        now: input.now,
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

  if (!failed.ok || !failed.value) return false;

  const task = await deps.repository.getTask(actor, {
    ownerUserId: input.job.ownerUserId,
    taskId: input.job.taskId,
  });
  if (task.ok && task.value) {
    await deps.repository.updateTaskSyncState(actor, {
      taskId: input.job.taskId,
      eventId: input.job.eventId,
      status: terminal ? "failed" : "pending",
      failureReason: input.message,
      nowIso: input.nowIso,
    });
  }

  if (input.job.runId && !terminal) {
    await deps.repository.updateRunItem(actor, {
      runId: input.job.runId,
      taskId: input.job.taskId,
      outcome: "pending",
      exclusionReason: input.exclusionReason ?? null,
      eventId: input.job.eventId,
      payloadHash: input.job.payloadHash,
      errorMessage: null,
      nowIso: input.nowIso,
    });
  }

  return true;
}

async function claimStillCurrent(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  job: CalendarJobRecord,
) {
  if (!job.claimToken) return false;
  const result = await deps.repository.isJobClaimCurrent(
    actor,
    job.id,
    job.claimToken,
  );
  return result.ok && result.value;
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
}> {
  const { job, connection, nowIso, now } = input;
  const config = getConfig(deps);

  if (!jobMatchesConnection(job, connection)) {
    await failJob(actor, deps, {
      job,
      message:
        "The Calendar destination changed after this job was queued. Its events remain in the previous calendar.",
      permanent: true,
      nowIso,
      now,
    });
    return {};
  }

  const taskResult = await deps.repository.getTask(actor, {
    ownerUserId: job.ownerUserId,
    taskId: job.taskId,
  });
  if (!taskResult.ok) {
    await failJob(actor, deps, {
      job,
      message: "Unable to load the task for Calendar sync.",
      permanent: false,
      nowIso,
      now,
    });
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
      await failJob(actor, deps, {
        job, message: "Unable to load the Calendar removal target.",
        permanent: false, nowIso, now,
      });
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
        await failJob(actor, deps, {
          job, message: lookup.error.message, permanent: lookup.error.kind === "permanent",
          retryAfterSeconds: lookup.error.retryAfterSeconds, nowIso, now,
        });
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
          await failJob(actor, deps, {
            job, message: "Unable to save the verified Calendar removal target.",
            permanent: false, nowIso, now,
          });
          return { refreshedCredentials };
        }
        if (!prepared.value) return { refreshedCredentials };
        eventId = plannedEventId;
      }
    }

    if (eventId) {
      if (!(await claimStillCurrent(actor, deps, job))) return { refreshedCredentials };
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
        await failJob(actor, deps, {
          job, message: deleted.error.message, permanent: deleted.error.kind === "permanent",
          retryAfterSeconds: deleted.error.retryAfterSeconds, nowIso, now,
        });
        return { refreshedCredentials };
      }
      refreshedCredentials = deleted.refreshedCredentials ?? refreshedCredentials;
    }

    await completeJobOutcome(actor, deps, {
      job, connection, outcome: eventId ? "removed" : "excluded",
      eventId: null, payloadHash: null, generation: removalGeneration, exclusionReason,
      mappingRemoval: eventId ? { eventId, generation: removalGeneration } : null,
      nowIso, taskSyncStatus: "skipped",
    });
    return { refreshedCredentials };
  }

  if (!built?.payload) {
    await failJob(actor, deps, {
      job,
      message: "The Calendar event payload could not be built.",
      permanent: true,
      nowIso,
      now,
    });
    return {};
  }

  const mappings = await deps.repository.loadMappingsForTasks(actor, {
    ownerUserId: job.ownerUserId,
    taskIds: [job.taskId],
  });
  if (!mappings.ok) {
    await failJob(actor, deps, {
      job, message: "Unable to load Calendar event mappings.",
      permanent: false, nowIso, now,
    });
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
    if (!job.claimToken) return false;
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
    if (!advanced.ok || !advanced.value) return false;
    targetEvent(eventId, nextGeneration);
    updating = false;
    return true;
  }

  let needsMappingLookup = false;
  if (mapping && mapping.generation >= generation) {
    if (mapping.status === "removed") {
      if (!(await rotateEvent(mapping.generation + 1))) return {};
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
      if (!(await rotateEvent(generation + 1))) return {};
    }
  }

  if (!(await claimStillCurrent(actor, deps, job))) return {};

  let writeResult = lookupFailure
    ? { ok: false as const, error: lookupFailure }
    : updating
      ? await deps.provider.updateEvent(connection, payload.eventId, payload)
      : await deps.provider.createEvent(connection, payload);

  if (!writeResult.ok && writeResult.error.kind === "not_found" && updating) {
    if (!(await rotateEvent(generation + 1))) return {};
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
        if (!(await rotateEvent(Math.max(generation, verifiedGeneration, mapping?.generation ?? 0) + 1))) return {};
        writeResult = await deps.provider.createEvent(connection, payload);
      } else if (metadataMatches && existing.value.status !== "cancelled") {
        if (!(await claimStillCurrent(actor, deps, job))) return {};
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

    await failJob(actor, deps, {
      job,
      message: writeResult.error.message,
      permanent: writeResult.error.kind === "permanent",
      retryAfterSeconds: writeResult.error.retryAfterSeconds,
      nowIso,
      now,
    });
    return {};
  }

  refreshedCredentials = writeResult.refreshedCredentials;
  const eventId = writeResult.value.id;
  if (!(await claimStillCurrent(actor, deps, job))) {
    return { refreshedCredentials };
  }
  await completeJobOutcome(actor, deps, {
    job,
    connection,
    outcome: updating ? "updated" : "created",
    eventId,
    payloadHash,
    generation,
    exclusionReason: null,
    nowIso,
    taskSyncStatus: "synced",
  });

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
          nextJob -= 1;
          return { persistenceError: result.persistenceError, refreshed };
        }
        if (result.authFailure) {
          nextJob -= 1;
          return { authFailure: true, staleAuth: result.staleAuth, refreshed };
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

  return { refreshed };
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

  let eventIndex = new Map<string, CalendarEventIndexEntry>();
  if (!run.scanComplete) {
    const observedCursor =
      run.scanCursorCreatedAt && run.scanCursorTaskId
        ? { createdAt: run.scanCursorCreatedAt, taskId: run.scanCursorTaskId }
        : null;
    const listing = await deps.provider.listManagedEvents(connection);
    if (!listing.ok) {
      if (isAuthorizationFailure(listing.error)) {
        const paused = await pauseForAuthorization(actor, deps, {
          runId: run.id,
          connection,
          expectedListingCursor: observedCursor,
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
        pause: terminalListingFailure,
        retryAt: terminalListingFailure
          ? null
          : nextCalendarRetryAtIso({
              jobId: run.id,
              attempts: 1,
              now,
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

    if (!listing.value.complete) {
      // An incomplete event listing is not proof that any managed event was
      // deleted, so the scan intentionally refuses to infer removals.
      const incompleteMessage =
        "The Calendar event listing was incomplete. No removals were attempted; retry to continue.";
      const recorded = await deps.repository.recordListingFailure(actor, {
        runId: run.id,
        expectedCursor: observedCursor,
        pause: false,
        retryAt: nextCalendarRetryAtIso({
          jobId: run.id,
          attempts: 1,
          now,
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

    if (listing.refreshedCredentials) {
      connection = await persistRefreshedCredentials(actor, deps, {
        connection,
        refreshed: listing.refreshedCredentials,
        nowIso,
      });
    }

    eventIndex = eventIndexFor(listing.value.events);
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

  const status = await buildStatus(actor, deps, run.id);
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
    message:
      run?.status === "paused" && run.lastError
        ? run.lastError
        : pausedRun
          ? `Sync for ${pausedRun.destination.calendarId} is paused. Events already published there remain in that calendar.`
          : null,
    continuationBlocked: false,
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
          nextJob -= 1;
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
