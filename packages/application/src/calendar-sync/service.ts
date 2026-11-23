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

export type CalendarSyncProcessResult = Readonly<{
  status: CalendarSyncStatusView;
  authFailure: boolean;
  retryable: boolean;
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
    message: pausedRun
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

async function pauseForAuthorization(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  input: {
    runId: string | null;
    connection: CalendarConnectionRecord;
    message: string;
    nowIso: string;
  },
) {
  await deps.repository.markReconnectRequired(actor, {
    ownerUserId: input.connection.ownerUserId,
    message: input.message,
    nowIso: input.nowIso,
  });
  if (input.runId) {
    await deps.repository.pauseRun(
      actor,
      input.runId,
      input.message,
      input.nowIso,
    );
  }
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
}>;

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
  | { ok: false; message: string; authFailure?: boolean; retryable?: boolean }
> {
  const config = getConfig(deps);
  let run = input.run;
  let refreshedCredentials: RefreshedCalendarCredentials | undefined;

  while (!run.scanComplete && Date.now() < input.deadline) {
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

    const pageResult = await deps.repository.loadTaskPage(actor, {
      ownerUserId: run.ownerUserId,
      cursor:
        run.scanCursorCreatedAt && run.scanCursorTaskId
          ? {
              createdAt: run.scanCursorCreatedAt,
              taskId: run.scanCursorTaskId,
            }
          : null,
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
      refreshedCredentials =
        planned.refreshedCredentials ?? refreshedCredentials;
      items.push(planned.item);
      if (planned.job) jobs.push(planned.job);
    }

    const commit: CalendarScanCommit = {
      runId: run.id,
      claimToken,
      nextCursor: page.nextCursor,
      scanComplete: page.complete,
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
  }

  // Remove managed events whose task row no longer exists. Orphan cleanup runs
  // only after the task scan has completed, so a not-yet-scanned page can never
  // be mistaken for a deleted task.
  while (run.scanComplete && Date.now() < input.deadline) {
    const claimToken = randomUUID();
    const claimed = await deps.repository.claimScan(actor, {
      runId: run.id,
      claimToken,
      nowIso: input.nowIso,
      leaseSeconds: config.leaseSeconds,
    });
    if (!claimed.ok || !claimed.value) break;

    const orphans = await deps.repository.listOrphanMappings(actor, {
      ownerUserId: run.ownerUserId,
      destinationKey: run.destination.destinationKey,
      limit: config.scanPageSize,
    });
    if (!orphans.ok || orphans.value.length === 0) {
      await deps.repository.commitScanPage(actor, {
        runId: run.id,
        claimToken,
        nextCursor:
          run.scanCursorCreatedAt && run.scanCursorTaskId
            ? {
                createdAt: run.scanCursorCreatedAt,
                taskId: run.scanCursorTaskId,
              }
            : null,
        scanComplete: true,
        items: [],
        jobs: [],
        nowIso: input.nowIso,
      });
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
      nextCursor:
        run.scanCursorCreatedAt && run.scanCursorTaskId
          ? {
              createdAt: run.scanCursorCreatedAt,
              taskId: run.scanCursorTaskId,
            }
          : null,
      scanComplete: true,
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
  const permanent = input.permanent || exhausted;
  const retryAt = permanent
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
      permanent,
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
      status: permanent ? "failed" : "pending",
      failureReason: input.message,
      nowIso: input.nowIso,
    });
  }

  if (input.job.runId) {
    await deps.repository.updateRunItem(actor, {
      runId: input.job.runId,
      taskId: input.job.taskId,
      outcome: permanent ? "failed" : "pending",
      exclusionReason: input.exclusionReason ?? null,
      eventId: input.job.eventId,
      payloadHash: input.job.payloadHash,
      errorMessage: permanent ? input.message : null,
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

  if (!task) {    if (job.operation === "delete" || job.eventId) {
      const deleted = job.eventId
        ? await deps.provider.deleteEvent(connection, job.eventId)
        : ({ ok: true, value: { alreadyRemoved: true }, refreshedCredentials: undefined } as const);

      if (!deleted.ok) {
        if (deleted.error.kind === "authorization") {
          await pauseForAuthorization(actor, deps, {
            runId: job.runId,
            connection,
            message: deleted.error.message,
            nowIso,
          });
          return { authFailure: true };
        }
        await failJob(actor, deps, {
          job,
          message: deleted.error.message,
          permanent: deleted.error.kind === "permanent",
          retryAfterSeconds: deleted.error.retryAfterSeconds,
          nowIso,
          now,
        });
        return {};
      }

      refreshedCredentials = deleted.refreshedCredentials;
      await completeJobOutcome(actor, deps, {
        job,
        connection,
        outcome: "removed",
        eventId: null,
        payloadHash: null,
        generation: job.generation,
        exclusionReason: job.exclusionReason,
        mappingRemoval: job.eventId
          ? { eventId: job.eventId, generation: job.generation }
          : null,
        nowIso,
        taskSyncStatus: "skipped",
      });
      return { refreshedCredentials };
    }

    await completeJobOutcome(actor, deps, {
      job,
      connection,
      outcome: "excluded",
      eventId: null,
      payloadHash: null,
      generation: job.generation,
      exclusionReason: job.exclusionReason,
      nowIso,
      taskSyncStatus: "skipped",
    });
    return {};
  }

  const built = buildCalendarEventPayload({
    ownerUserId: task.ownerUserId,
    task,
    destination: job.destination,
    generation: job.generation,
    eventId:
      job.eventId ??
      deterministicCalendarEventId({
        ownerUserId: task.ownerUserId,
        taskId: task.id,
        destinationKey: job.destination.destinationKey,
        generation: job.generation,
      }),
    linkBaseUrl: config.linkBaseUrl,
  });

  if (built.plan.kind === "excluded") {
    if (!job.eventId) {
      await completeJobOutcome(actor, deps, {
        job,
        connection,
        outcome: "excluded",
        eventId: null,
        payloadHash: null,
        generation: job.generation,
        exclusionReason: built.plan.exclusionReason,
        nowIso,
        taskSyncStatus: "skipped",
      });
      return {};
    }

    const deleted = await deps.provider.deleteEvent(connection, job.eventId);
    if (!deleted.ok) {
      if (deleted.error.kind === "authorization") {
        await pauseForAuthorization(actor, deps, {
          runId: job.runId,
          connection,
          message: deleted.error.message,
          nowIso,
        });
        return { authFailure: true };
      }
      await failJob(actor, deps, {
        job,
        message: deleted.error.message,
        permanent: deleted.error.kind === "permanent",
        retryAfterSeconds: deleted.error.retryAfterSeconds,
        nowIso,
        now,
      });
      return {};
    }

    refreshedCredentials = deleted.refreshedCredentials;
    await completeJobOutcome(actor, deps, {
      job,
      connection,
      outcome: "removed",
      eventId: null,
      payloadHash: null,
      generation: job.generation,
      exclusionReason: built.plan.exclusionReason,
      mappingRemoval: job.eventId
        ? { eventId: job.eventId, generation: job.generation }
        : null,
      nowIso,
      taskSyncStatus: "skipped",
    });
    return { refreshedCredentials };
  }

  if (!built.payload) {
    await failJob(actor, deps, {
      job,
      message: "The Calendar event payload could not be built.",
      permanent: true,
      nowIso,
      now,
    });
    return {};
  }

  const payload = { ...built.payload, eventId: job.eventId ?? built.payload.eventId };

  if (job.operation === "delete") {
    const deleted = await deps.provider.deleteEvent(connection, payload.eventId);
    if (!deleted.ok) {
      if (deleted.error.kind === "authorization") {
        await pauseForAuthorization(actor, deps, {
          runId: job.runId,
          connection,
          message: deleted.error.message,
          nowIso,
        });
        return { authFailure: true };
      }
      await failJob(actor, deps, {
        job,
        message: deleted.error.message,
        permanent: deleted.error.kind === "permanent",
        retryAfterSeconds: deleted.error.retryAfterSeconds,
        nowIso,
        now,
      });
      return {};
    }

    refreshedCredentials = deleted.refreshedCredentials;
    await completeJobOutcome(actor, deps, {
      job,
      connection,
      outcome: "removed",
      eventId: null,
      payloadHash: null,
      generation: job.generation,
      exclusionReason: job.exclusionReason,
      mappingRemoval: { eventId: payload.eventId, generation: job.generation },
      nowIso,
      taskSyncStatus: "skipped",
    });
    return { refreshedCredentials };
  }

  let writeResult = job.eventExists && job.eventId
    ? await deps.provider.updateEvent(connection, payload.eventId, payload)
    : await deps.provider.createEvent(connection, payload);

  if (!writeResult.ok && writeResult.error.kind === "not_found" && job.eventId) {
    // The managed event was deleted externally. Advance the generation only
    // after the deletion is confirmed, then create exactly one replacement.
    // The mapping stays on the old generation until the upsert below retires
    // it, so a crash before the replacement is published cannot retire a
    // mapping that a newer generation still owns.
    if (!(await claimStillCurrent(actor, deps, job))) {
      return { refreshedCredentials };
    }

    const generation = job.generation + 1;
    const eventId = deterministicCalendarEventId({
      ownerUserId: task.ownerUserId,
      taskId: task.id,
      destinationKey: job.destination.destinationKey,
      generation,
    });
    const nextPayload = {
      ...payload,
      eventId,
      privateProperties: {
        ...payload.privateProperties,
        generation: String(generation),
      },
    };
    if (job.claimToken) {
      const advanced = await deps.repository.advanceJobGeneration(actor, {
        jobId: job.id,
        claimToken: job.claimToken,
        generation,
        eventId,
        payloadHash: built.payloadHash,
        nowIso,
      });
      if (!advanced.ok || !advanced.value) {
        return { refreshedCredentials };
      }
    }
    writeResult = await deps.provider.createEvent(connection, nextPayload);
    if (writeResult.ok) {
      if (!(await claimStillCurrent(actor, deps, job))) {
        return { refreshedCredentials: writeResult.refreshedCredentials };
      }
      const mapping = await deps.repository.upsertMapping(actor, {
        ownerUserId: task.ownerUserId,
        taskId: task.id,
        destination: job.destination,
        eventId,
        generation,
        metadataVerified: true,
        payloadHash: built.payloadHash,
        nowIso,
      });
      if (mapping.ok) {
        await completeJobOutcome(actor, deps, {
          job,
          connection,
          outcome: "created",
          eventId,
          payloadHash: built.payloadHash,
          generation,
          exclusionReason: null,
          nowIso,
          taskSyncStatus: "synced",
        });
      }
    }
  } else if (!writeResult.ok && writeResult.error.kind === "conflict") {
    // A 409 on insert means the deterministic id already exists. Adopt it only
    // when its private metadata proves the expected task and destination.
    const existing = await deps.provider.getEvent(connection, payload.eventId);
    if (existing.ok && existing.value) {
      const privateProperties = existing.value.privateProperties;
      const metadataMatches =
        existing.value.status !== "cancelled" &&
        privateProperties.source === "ega-house" &&
        privateProperties.task_id === task.id &&
        privateProperties.owner_user_id === task.ownerUserId &&
        privateProperties.destination_key ===
          job.destination.destinationKey;
      if (metadataMatches) {
        writeResult = await deps.provider.updateEvent(
          connection,
          payload.eventId,
          payload,
        );
      } else {
        await failJob(actor, deps, {
          job,
          message:
            "A Google Calendar event with the deterministic id already exists for a different task or calendar. It was left untouched.",
          permanent: true,
          nowIso,
          now,
        });
        return {};
      }
    }
  }

  if (!writeResult.ok) {
    if (writeResult.error.kind === "authorization") {
      await pauseForAuthorization(actor, deps, {
        runId: job.runId,
        connection,
        message: writeResult.error.message,
        nowIso,
      });
      return { authFailure: true };
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
  const mappingResult = await deps.repository.upsertMapping(actor, {
    ownerUserId: task.ownerUserId,
    taskId: task.id,
    destination: job.destination,
    eventId,
    generation: job.generation,
    metadataVerified: true,
    payloadHash: built.payloadHash,
    nowIso,
  });

  if (!mappingResult.ok) {
    // Leave the job processing so its lease expires and retrieval retries the
    // same deterministic event id. Never report success without a mapping.
    return { refreshedCredentials };
  }

  await completeJobOutcome(actor, deps, {
    job,
    connection,
    outcome: job.eventExists ? "updated" : "created",
    eventId,
    payloadHash: built.payloadHash,
    generation: job.generation,
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
  if (!input.refreshed.accessTokenEncrypted) return;
  await deps.repository.updateConnectionCredentials(actor, {
    ownerUserId: input.connection.ownerUserId,
    expectedUpdatedAt: input.connection.updatedAt,
    credentials: input.refreshed,
    nowIso: input.nowIso,
  });
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

    if (!claimed.ok || claimed.value.length === 0) break;

    const jobs = claimed.value;
    for (let index = 0; index < jobs.length; index += 1) {
      if (Date.now() >= input.deadline) {
        await deps.repository.releaseJobs(actor, {
          jobIds: jobs.slice(index).map((job) => job.id),
          claimToken,
          nowIso: input.nowIso,
        });
        break;
      }

      const result = await processJob(actor, deps, {
        job: jobs[index],
        connection: input.connection,
        nowIso: input.nowIso,
        now: input.now,
      });
      refreshed = result.refreshedCredentials ?? refreshed;
      processed += 1;
      if (result.authFailure) {
        return { authFailure: true, refreshed };
      }
    }
  }

  return { refreshed };
}

async function processRunBatch(
  actor: AuthenticatedActor,
  deps: CalendarSyncDependencies,
  run: CalendarRunRecord,
): Promise<CalendarSyncProcessResult> {
  const now = getNow(deps);
  const nowIso = now.toISOString();
  const config = getConfig(deps);
  const deadline = Date.now() + config.requestBudgetMs;

  const connectionResult = await deps.repository.getConnectionForOwner(
    actor,
    run.ownerUserId,
  );
  if (!connectionResult.ok || !connectionResult.value) {
    return {
      status: withStatusMessage(
        await buildStatus(actor, deps, run.id),
        "The Google Calendar connection is unavailable. Reconnect and retry.",
      ),
      authFailure: true,
      retryable: false,
    };
  }

  const connection = connectionResult.value;
  const destination = destinationOfConnection(connection);

  if (!isConnectionUsable(connection)) {
    await pauseForAuthorization(actor, deps, {
      runId: run.id,
      connection,
      message:
        "Google Calendar needs to be reconnected before sync can continue.",
      nowIso,
    });
    return {
      status: withStatusMessage(
        await buildStatus(actor, deps, run.id),
        "Google Calendar needs to be reconnected before sync can continue.",
      ),
      authFailure: true,
      retryable: false,
    };
  }

  if (!isVerifiedCalendarDestination(destination)) {
    await pauseForAuthorization(actor, deps, {
      runId: run.id,
      connection,
      message:
        "Google Calendar account identity could not be verified. Reconnect Google Calendar before sync can continue.",
      nowIso,
    });
    return {
      status: withStatusMessage(
        await buildStatus(actor, deps, run.id),
        "Google Calendar account identity could not be verified. Reconnect Google Calendar before sync can continue.",
      ),
      authFailure: true,
      retryable: false,
    };
  }

  if (!isVerifiedCalendarDestination(run.destination)) {
    const message =
      "This Calendar sync run predates verified account binding. Reconnect Google Calendar and start a new sync.";
    await deps.repository.pauseRun(actor, run.id, message, nowIso);
    return {
      status: withStatusMessage(
        await buildStatus(actor, deps, run.id),
        message,
      ),
      authFailure: false,
      retryable: false,
    };
  }

  if (!sameVerifiedCalendarDestination(destination, run.destination)) {
    await deps.repository.pauseRun(
      actor,
      run.id,
      `The Calendar destination changed to ${destination.calendarId}. Events already published to ${run.destination.calendarId} remain there.`,
      nowIso,
    );
    return {
      status: withStatusMessage(
        await buildStatus(actor, deps, run.id),
        `The Calendar destination changed. Events sent to ${run.destination.calendarId} remain there and were not moved.`,
      ),
      authFailure: false,
      retryable: false,
    };
  }

  const listing = await deps.provider.listManagedEvents(connection);
  if (!listing.ok) {
    if (isAuthorizationFailure(listing.error)) {
      await pauseForAuthorization(actor, deps, {
        runId: run.id,
        connection,
        message: listing.error.message,
        nowIso,
      });
      return {
        status: withStatusMessage(
          await buildStatus(actor, deps, run.id),
          listing.error.message,
        ),
        authFailure: true,
        retryable: false,
      };
    }

    return {
      status: withStatusMessage(
        await buildStatus(actor, deps, run.id),
        "Google Calendar events could not be verified. No removals were attempted; retry to continue.",
      ),
      authFailure: false,
      retryable: true,
    };
  }

  if (!listing.value.complete) {
    // An incomplete event listing is not proof that any managed event was
    // deleted, so the scan intentionally refuses to infer removals.
    return {
      status: withStatusMessage(
        await buildStatus(actor, deps, run.id),
        "The Calendar event listing was incomplete. No removals were attempted; retry to continue.",
      ),
      authFailure: false,
      retryable: true,
    };
  }

  if (listing.refreshedCredentials) {
    await persistRefreshedCredentials(actor, deps, {
      connection,
      refreshed: listing.refreshedCredentials,
      nowIso,
    });
  }

  const eventIndex = eventIndexFor(listing.value.events);
  const scanResult = await scanRun(actor, deps, {
    run,
    connection,
    eventIndex,
    deadline,
    nowIso,
  });

  if (!scanResult.ok) {
    return {
      status: withStatusMessage(
        await buildStatus(actor, deps, run.id),
        scanResult.message,
      ),
      authFailure: Boolean(scanResult.authFailure),
      retryable: scanResult.retryable ?? false,
    };
  }

  if (scanResult.refreshedCredentials) {
    await persistRefreshedCredentials(actor, deps, {
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

  await deps.repository.completeRunIfDrained(actor, {
    runId: run.id,
    nowIso,
  });

  const status = await buildStatus(actor, deps, run.id);
  return {
    status: drained.authFailure
      ? withStatusMessage(
          status,
          "Google Calendar authorization expired. Reconnect and retry.",
        )
      : status,
    authFailure: Boolean(drained.authFailure),
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
    message: pausedRun
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
  const runs = await deps.repository.listActiveRuns(actor, options?.runLimit ?? 5);
  if (!runs.ok) {
    return applicationFailure("Unable to load active Calendar sync runs.");
  }

  let runsProcessed = 0;
  for (const run of runs.value) {
    await processRunBatch(actor, deps, run);
    runsProcessed += 1;
  }

  const destinations = await deps.repository.listReadyDestinations(
    actor,
    options?.destinationLimit ?? 5,
  );
  if (!destinations.ok) {
    return applicationSuccess({
      runsProcessed,
      destinationsProcessed: 0,
      jobsProcessed: 0,
    });
  }

  let destinationsProcessed = 0;
  let jobsProcessed = 0;
  for (const queue of destinations.value) {
    // A destination whose account or calendar cannot be verified is left
    // pending for a later recovery pass instead of being written through the
    // currently connected account.
    if (!isVerifiedCalendarDestination(queue.destination)) continue;

    const connection = await deps.repository.getConnectionForOwner(
      actor,
      queue.ownerUserId,
    );
    if (!connection.ok || !connection.value || !isConnectionUsable(connection.value)) {
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
    if (!claimed.ok || claimed.value.length === 0) continue;

    let refreshed:
      | RefreshedCalendarCredentials
      | undefined;
    for (const job of claimed.value) {
      const result = await processJob(actor, deps, {
        job,
        connection: connection.value,
        nowIso,
        now,
      });
      refreshed = result.refreshedCredentials ?? refreshed;
      jobsProcessed += 1;
    }
    if (refreshed) {
      await persistRefreshedCredentials(actor, deps, {
        connection: connection.value,
        refreshed,
        nowIso,
      });
    }
    destinationsProcessed += 1;
  }

  return applicationSuccess({
    runsProcessed,
    destinationsProcessed,
    jobsProcessed,
  });
}
