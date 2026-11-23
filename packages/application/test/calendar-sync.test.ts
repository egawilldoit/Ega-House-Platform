import assert from "node:assert/strict";
import test from "node:test";

import {
  addCalendarDays,
  planCalendarTaskEvent,
} from "@ega/domain";
import type { AuthenticatedActor } from "@ega/application/auth/actor";
import type {
  CalendarConnectionRecord,
  CalendarEventDocument,
  CalendarEventIndexEntry,
  CalendarEventPayload,
  CalendarEventProvider,
  CalendarJobRecord,
  CalendarMappingRecord,
  CalendarProviderResult,
  CalendarReadyQueue,
  CalendarRunCounts,
  CalendarRunExclusionCount,
  CalendarRunFailure,
  CalendarRunItemDraft,
  CalendarRunRecord,
  CalendarScanCommit,
  CalendarScanCursor,
  CalendarSyncDestination,
  CalendarSyncItemOutcome,
  CalendarSyncRepository,
  CalendarTaskPage,
  CalendarTaskScanRecord,
} from "@ega/application/calendar-sync/ports";
import { deterministicCalendarEventId } from "@ega/application/calendar-sync/rules";
import {
  continueCalendarSync,
  getCalendarSyncStatus,
  processCalendarRecovery,
  startCalendarSync,
} from "@ega/application/calendar-sync/service";

const actor: AuthenticatedActor = { userId: "owner-1" };
const destination: CalendarSyncDestination = {
  accountSubject: "google-subject-1",
  accountEmail: "owner@example.com",
  calendarId: "primary",
  destinationKey: "owner@example.com|primary",
};

function task(overrides: Partial<CalendarTaskScanRecord> = {}): CalendarTaskScanRecord {
  return {
    id: "task-1",
    ownerUserId: actor.userId,
    title: "Plan deep work",
    status: "todo",
    archivedAt: null,
    completedAt: null,
    calendarSyncEnabled: true,
    calendarReminderMinutes: 15,
    scheduledStartAt: "2026-05-10T09:00:00.000Z",
    scheduledEndAt: "2026-05-10T10:00:00.000Z",
    plannedForDate: null,
    dueDate: null,
    calendarEventId: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

class FakeProvider implements CalendarEventProvider {
  events = new Map<string, CalendarEventDocument>();
  deletedEventIds = new Set<string>();
  retainDeletedEventIds = false;
  createCalls = 0;
  updateCalls = 0;
  deleteCalls = 0;
  getCalls = 0;
  nextListFailure: { kind: "authorization" | "retryable" | "permanent"; message: string } | null = null;
  nextGetFailure: { kind: "authorization" | "retryable" | "permanent"; message: string } | null = null;

  private result<T>(value: T): CalendarProviderResult<T> {
    return { ok: true, value, refreshedCredentials: undefined };
  }

  async listManagedEvents(): Promise<
    CalendarProviderResult<{ complete: boolean; events: CalendarEventIndexEntry[] }>
  > {
    if (this.nextListFailure) {
      const failure = this.nextListFailure;
      this.nextListFailure = null;
      return { ok: false, error: failure };
    }

    return this.result({
      complete: true,
      // Google filters this listing by the EGA House source tag. Events whose
      // tag was stripped are no longer listed even though they still exist.
      events: [...this.events.values()]
        .filter((event) => event.privateProperties.source === "ega-house")
        .map((event) => ({
          id: event.id,
          status: event.status,
          source: event.privateProperties.source ?? null,
          taskId: event.privateProperties.task_id ?? null,
          ownerUserId: event.privateProperties.owner_user_id ?? null,
          destinationKey: event.privateProperties.destination_key ?? null,
          generation: event.privateProperties.generation
            ? Number(event.privateProperties.generation)
            : null,
          payloadHash: event.privateProperties.payload_hash ?? null,
        })),
    });
  }

  async getEvent(
    _connection: CalendarConnectionRecord,
    eventId: string,
  ): Promise<CalendarProviderResult<CalendarEventDocument | null>> {
    this.getCalls += 1;
    if (this.nextGetFailure) {
      const failure = this.nextGetFailure;
      this.nextGetFailure = null;
      return { ok: false, error: failure };
    }
    return this.result(this.events.get(eventId) ?? null);
  }

  async createEvent(
    _connection: CalendarConnectionRecord,
    payload: CalendarEventPayload,
  ): Promise<CalendarProviderResult<CalendarEventDocument>> {
    this.createCalls += 1;
    if (this.events.has(payload.eventId) || this.deletedEventIds.has(payload.eventId)) {
      return {
        ok: false,
        error: { kind: "conflict", message: "Event id already exists." },
      };
    }
    const document: CalendarEventDocument = {
      id: payload.eventId,
      status: "confirmed",
      summary: payload.summary,
      start: payload.start,
      end: payload.end,
      privateProperties: payload.privateProperties,
      raw: {},
    };
    this.events.set(document.id, document);
    return this.result(document);
  }

  async updateEvent(
    _connection: CalendarConnectionRecord,
    eventId: string,
    payload: CalendarEventPayload,
  ): Promise<CalendarProviderResult<CalendarEventDocument>> {
    this.updateCalls += 1;
    if (!this.events.has(eventId)) {
      return {
        ok: false,
        error: { kind: "not_found", message: "Missing event." },
      };
    }
    const document: CalendarEventDocument = {
      id: eventId,
      status: "confirmed",
      summary: payload.summary,
      start: payload.start,
      end: payload.end,
      privateProperties: payload.privateProperties,
      raw: {},
    };
    this.events.set(eventId, document);
    return this.result(document);
  }

  async deleteEvent(
    _connection: CalendarConnectionRecord,
    eventId: string,
  ): Promise<CalendarProviderResult<{ alreadyRemoved: boolean }>> {
    this.deleteCalls += 1;
    const existed = this.events.delete(eventId);
    if (existed && this.retainDeletedEventIds) this.deletedEventIds.add(eventId);
    return this.result({ alreadyRemoved: !existed });
  }
}

class FakeRepository implements CalendarSyncRepository {
  connection: CalendarConnectionRecord = {
    ownerUserId: actor.userId,
    provider: "google",
    ...destination,
    accessTokenEncrypted: "access",
    refreshTokenEncrypted: "refresh",
    tokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-05-01T00:00:00.000Z",
    disconnectedAt: null,
    reconnectRequiredAt: null,
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  tasks = new Map<string, CalendarTaskScanRecord>();
  runs = new Map<string, CalendarRunRecord>();
  items = new Map<string, (CalendarRunItemDraft & { runId: string })[]>();
  mappings = new Map<string, CalendarMappingRecord>();
  jobs = new Map<string, CalendarJobRecord>();
  failNextOrphanDeleteCommit = false;
  failNextCompletion = false;
  private jobCounter = 0;

  addTask(row: CalendarTaskScanRecord) {
    this.tasks.set(row.id, row);
  }

  private mappingKey(taskId: string, destinationKey = destination.destinationKey) {
    return `${actor.userId}|${taskId}|${destinationKey}`;
  }

  private runItems(runId: string) {
    return this.items.get(runId) ?? [];
  }

  async getConnection(): Promise<{ ok: true; value: CalendarConnectionRecord }> {
    return { ok: true, value: this.connection };
  }

  async getConnectionForOwner(): Promise<{ ok: true; value: CalendarConnectionRecord }> {
    return { ok: true, value: this.connection };
  }

  async updateConnectionCredentials(): Promise<{ ok: true; value: boolean }> {
    return { ok: true, value: true };
  }

  async markReconnectRequired(): Promise<{ ok: true; value: undefined }> {
    this.connection = { ...this.connection, reconnectRequiredAt: new Date().toISOString() };
    return { ok: true, value: undefined };
  }

  async ensureRun(
    _actor: AuthenticatedActor,
    input: { destination: CalendarSyncDestination; retryMode: boolean; nowIso: string },
  ): Promise<{ ok: true; value: CalendarRunRecord }> {
    const existing = [...this.runs.values()].find(
      (run) =>
        run.destination.destinationKey === input.destination.destinationKey &&
        (run.status === "active" ||
          run.status === "paused" ||
          (input.retryMode && run.status === "completed")),
    );
    if (existing) {
      const run = {
        ...existing,
        status: "active" as const,
        retryMode: input.retryMode,
        completedAt: null,
        updatedAt: input.nowIso,
      };
      this.runs.set(run.id, run);
      return { ok: true, value: run };
    }
    const run: CalendarRunRecord = {
      id: `run-${this.runs.size + 1}`,
      ownerUserId: actor.userId,
      destination: input.destination,
      status: "active",
      retryMode: input.retryMode,
      scanComplete: false,
      scanCursorCreatedAt: null,
      scanCursorTaskId: null,
      lastError: null,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
      completedAt: null,
    };
    this.runs.set(run.id, run);
    return { ok: true, value: run };
  }

  async getRun(_actor: AuthenticatedActor, runId: string) {
    return { ok: true as const, value: this.runs.get(runId) ?? null };
  }

  async getLatestRun(_actor: AuthenticatedActor, destinationKey: string) {
    const runs = [...this.runs.values()]
      .filter((run) => run.destination.destinationKey === destinationKey)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true as const, value: runs[0] ?? null };
  }

  async getPausedRun(_actor: AuthenticatedActor, destinationKey: string) {
    const run = [...this.runs.values()].find(
      (candidate) =>
        candidate.status === "paused" &&
        candidate.destination.destinationKey !== destinationKey,
    );
    return { ok: true as const, value: run ?? null };
  }

  async pauseRun(
    _actor: AuthenticatedActor,
    runId: string,
    message: string,
    nowIso: string,
  ) {
    const run = this.runs.get(runId);
    if (run) {
      this.runs.set(runId, { ...run, status: "paused", lastError: message, updatedAt: nowIso });
    }
    return { ok: true as const, value: undefined };
  }

  async requeueRetryableJobs() {
    return { ok: true as const, value: 0 };
  }

  async getRunCounts(_actor: AuthenticatedActor, runId: string) {
    const items = this.runItems(runId);
    const count = (outcome: CalendarSyncItemOutcome) =>
      items.filter((item) => item.outcome === outcome).length;
    const jobs = [...this.jobs.values()].filter((job) => job.runId === runId);
    const counts: CalendarRunCounts = {
      total: items.length,
      created: count("created"),
      updated: count("updated"),
      removed: count("removed"),
      unchanged: count("unchanged"),
      excluded: count("excluded"),
      failed: count("failed"),
      pending: count("pending"),
      retrying: jobs.filter(
        (job) =>
          job.status === "pending" &&
          job.attempts > 0 &&
          new Date(job.scheduledAt).getTime() > Date.now(),
      ).length,
      processing: jobs.filter((job) => job.status === "processing").length,
      ready: jobs.filter(
        (job) =>
          job.status === "processing" ||
          (job.status === "pending" &&
            new Date(job.scheduledAt).getTime() <= Date.now()),
      ).length,
    };
    return { ok: true as const, value: counts };
  }

  async listExclusionCounts(
    _actor: AuthenticatedActor,
    runId: string,
  ): Promise<{ ok: true; value: CalendarRunExclusionCount[] }> {
    const counts = new Map<string, number>();
    for (const item of this.runItems(runId)) {
      if (!item.exclusionReason) continue;
      counts.set(item.exclusionReason, (counts.get(item.exclusionReason) ?? 0) + 1);
    }
    return {
      ok: true,
      value: [...counts.entries()].map(([reason, count]) => ({
        reason: reason as CalendarRunExclusionCount["reason"],
        count,
      })),
    };
  }

  async listRunFailures(): Promise<{ ok: true; value: CalendarRunFailure[] }> {
    return { ok: true, value: [] };
  }

  async claimScan(): Promise<{ ok: true; value: boolean }> {
    return { ok: true, value: true };
  }

  async loadTaskPage(
    _actor: AuthenticatedActor,
    input: { cursor: CalendarScanCursor | null; limit: number },
  ): Promise<{ ok: true; value: CalendarTaskPage }> {
    const sorted = [...this.tasks.values()].sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.id.localeCompare(b.id)
        : a.createdAt.localeCompare(b.createdAt),
    );
    const filtered = input.cursor
      ? sorted.filter(
          (row) =>
            row.createdAt > input.cursor!.createdAt ||
            (row.createdAt === input.cursor!.createdAt &&
              row.id > input.cursor!.taskId),
        )
      : sorted;
    const page = filtered.slice(0, input.limit);
    const hasMore = filtered.length > input.limit;
    return {
      ok: true,
      value: {
        tasks: page,
        nextCursor: hasMore
          ? { createdAt: page[page.length - 1].createdAt, taskId: page[page.length - 1].id }
          : null,
        complete: !hasMore,
      },
    };
  }

  async getTask(_actor: AuthenticatedActor, input: { taskId: string }) {
    return { ok: true as const, value: this.tasks.get(input.taskId) ?? null };
  }

  async loadMappingsForTasks(
    _actor: AuthenticatedActor,
    input: { taskIds: string[] },
  ) {
    return {
      ok: true as const,
      value: [...this.mappings.values()].filter((mapping) =>
        input.taskIds.includes(mapping.taskId),
      ),
    };
  }

  async commitScanPage(
    _actor: AuthenticatedActor,
    commit: CalendarScanCommit,
  ): Promise<
    | { ok: true; value: boolean }
    | { ok: false; error: { code: "unknown" } }
  > {
    if (
      this.failNextOrphanDeleteCommit &&
      commit.jobs.some((job) => job.operation === "delete")
    ) {
      this.failNextOrphanDeleteCommit = false;
      return { ok: false, error: { code: "unknown" } };
    }
    const existing = this.runItems(commit.runId).filter(
      (item) => !commit.items.some((next) => next.taskId === item.taskId),
    );
    this.items.set(commit.runId, [
      ...existing,
      ...commit.items.map((item) => ({ ...item, runId: commit.runId })),
    ]);

    for (const draft of commit.jobs) {
      const run = this.runs.get(commit.runId);
      const jobDestination = run?.destination ?? destination;
      const existingJob = [...this.jobs.values()].find(
        (job) =>
          job.runId === commit.runId &&
          job.taskId === draft.taskId &&
          job.status === "pending",
      );
      const job: CalendarJobRecord = {
        id: existingJob?.id ?? `job-${++this.jobCounter}`,
        ownerUserId: actor.userId,
        taskId: draft.taskId,
        runId: commit.runId,
        destination: jobDestination,
        operation: draft.operation,
        status: "pending",
        attempts: 0,
        eventId: draft.eventId,
        generation: draft.generation,
        eventExists: draft.eventExists,
        payloadHash: draft.payloadHash,
        claimToken: null,
        permanentFailure: false,
        exclusionReason: draft.exclusionReason,
        lastError: null,
        scheduledAt: commit.nowIso,
        taskUpdatedAt: draft.taskUpdatedAt,
      };
      this.jobs.set(job.id, job);
    }

    const run = this.runs.get(commit.runId);
    if (run) {
      this.runs.set(commit.runId, {
        ...run,
        scanComplete: commit.scanComplete,
        scanCursorCreatedAt: commit.nextCursor?.createdAt ?? null,
        scanCursorTaskId: commit.nextCursor?.taskId ?? null,
        updatedAt: commit.nowIso,
      });
    }
    return { ok: true, value: true };
  }

  async listOrphanMappings(): Promise<{ ok: true; value: CalendarMappingRecord[] }> {
    return {
      ok: true,
      value: [...this.mappings.values()].filter(
        (mapping) =>
          mapping.status === "active" &&
          !this.tasks.has(mapping.taskId) &&
          ![...this.jobs.values()].some(
            (job) =>
              job.taskId === mapping.taskId &&
              job.destination.destinationKey ===
                mapping.destination.destinationKey &&
              ["pending", "processing"].includes(job.status),
          ),
      ),
    };
  }

  async claimJobs(
    _actor: AuthenticatedActor,
    input: { runId: string | null; claimToken: string; limit: number },
  ): Promise<{ ok: true; value: CalendarJobRecord[] }> {
    const jobs = [...this.jobs.values()]
      .filter(
        (job) =>
          job.status === "pending" &&
          (!input.runId || job.runId === input.runId),
      )
      .slice(0, input.limit)
      .map((job) => ({
        ...job,
        status: "processing" as const,
        claimToken: input.claimToken,
        attempts: job.attempts + 1,
      }));
    for (const job of jobs) this.jobs.set(job.id, job);
    return { ok: true, value: jobs };
  }

  async releaseJobs(
    _actor: AuthenticatedActor,
    input: { jobIds: string[]; claimToken: string },
  ) {
    for (const id of input.jobIds) {
      const job = this.jobs.get(id);
      if (job && job.claimToken === input.claimToken) {
        this.jobs.set(id, { ...job, status: "pending", claimToken: null });
      }
    }
    return { ok: true as const, value: undefined };
  }

  async isJobClaimCurrent(
    _actor: AuthenticatedActor,
    jobId: string,
    claimToken: string,
  ) {
    const job = this.jobs.get(jobId);
    return {
      ok: true as const,
      value: Boolean(job && job.status === "processing" && job.claimToken === claimToken),
    };
  }

  async advanceJobGeneration(
    _actor: AuthenticatedActor,
    input: {
      jobId: string;
      claimToken: string;
      generation: number;
      eventId: string;
      payloadHash: string | null;
    },
  ) {
    const job = this.jobs.get(input.jobId);
    if (!job || job.claimToken !== input.claimToken) {
      return { ok: true as const, value: false };
    }
    this.jobs.set(input.jobId, {
      ...job,
      generation: input.generation,
      eventId: input.eventId,
      eventExists: false,
      payloadHash: input.payloadHash,
    });
    return { ok: true as const, value: true };
  }

  async completeJob(
    _actor: AuthenticatedActor,
    input: {
      job: CalendarJobRecord;
      claimToken: string;
      completion: {
        outcome: "created" | "updated" | "removed" | "unchanged" | "excluded";
        eventId: string | null;
        generation: number;
        payloadHash: string | null;
        exclusionReason: CalendarRunItemDraft["exclusionReason"];
        mappingRemoval?: { eventId: string; generation: number } | null;
      };
    },
  ) {
    const job = this.jobs.get(input.job.id);
    if (!job || job.claimToken !== input.claimToken) {
      return { ok: true as const, value: false };
    }

    if (this.failNextCompletion) {
      this.failNextCompletion = false;
      return { ok: false as const, error: { code: "conflict" as const } };
    }
    if ((input.completion.outcome === "created" || input.completion.outcome === "updated") && input.completion.eventId) {
      const mapping = await this.upsertMapping(_actor, {
        ownerUserId: job.ownerUserId, taskId: job.taskId, destination: job.destination,
        eventId: input.completion.eventId, generation: input.completion.generation,
        metadataVerified: true, payloadHash: input.completion.payloadHash,
        nowIso: "2026-05-10T09:00:00.000Z",
      });
      if (!mapping.ok) return { ok: false as const, error: mapping.error };
    }
    const removal = input.completion.mappingRemoval ?? null;
    if (removal) {
      const key = this.mappingKey(job.taskId, job.destination.destinationKey);
      const mapping = this.mappings.get(key);
      if (!mapping) {
        const result = await this.upsertMapping(_actor, {
          ownerUserId: job.ownerUserId,
          taskId: job.taskId,
          destination: job.destination,
          eventId: removal.eventId,
          generation: removal.generation,
          metadataVerified: true,
          payloadHash: null,
          nowIso: "2026-05-10T09:00:00.000Z",
        });
        if (!result.ok) return result;
        this.mappings.set(key, { ...result.value, status: "removed" });
      } else if (
        mapping.status === "active" &&
        mapping.eventId === removal.eventId &&
        mapping.generation === removal.generation
      ) {
        this.mappings.set(key, {
          ...mapping,
          status: "removed",
          metadataVerified: true,
        });
      }
    }

    this.jobs.set(job.id, {
      ...job,
      status: "succeeded",
      eventId: input.completion.eventId,
      generation: input.completion.generation,
      eventExists: Boolean(input.completion.eventId),
      payloadHash: input.completion.payloadHash,
      claimToken: null,
    });

    if (job.runId) {
      const items = this.runItems(job.runId).map((item) =>
        item.taskId === job.taskId
          ? {
              ...item,
              outcome: input.completion.outcome,
              exclusionReason: input.completion.exclusionReason,
              eventId: input.completion.eventId,
              payloadHash: input.completion.payloadHash,
            }
          : item,
      );
      this.items.set(job.runId, items);
    }

    return { ok: true as const, value: true };
  }

  async failJob(
    _actor: AuthenticatedActor,
    input: {
      job: CalendarJobRecord;
      claimToken: string;
      failure: { permanent: boolean; message: string; retryAt: string | null; outcome: "failed" | "excluded" };
    },
  ) {
    const job = this.jobs.get(input.job.id);
    if (!job || job.claimToken !== input.claimToken) {
      return { ok: true as const, value: false };
    }
    this.jobs.set(job.id, {
      ...job,
      status: input.failure.permanent ? "failed" : "pending",
      permanentFailure: input.failure.permanent,
      lastError: input.failure.message,
      scheduledAt: input.failure.retryAt ?? job.scheduledAt,
      claimToken: null,
    });
    return { ok: true as const, value: true };
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
  ) {
    const key = this.mappingKey(input.taskId, input.destination.destinationKey);
    const previous = this.mappings.get(key);
    if (previous && previous.generation > input.generation) {
      return { ok: false as const, error: { code: "conflict" as const } };
    }
    const mapping: CalendarMappingRecord = {
      id: previous?.id ?? `mapping-${this.mappings.size + 1}`,
      ownerUserId: input.ownerUserId,
      taskId: input.taskId,
      destination: input.destination,
      eventId: input.eventId,
      generation: input.generation,
      status: "active",
      metadataVerified: input.metadataVerified,
      payloadHash: input.payloadHash,
      lastSyncedAt: input.nowIso,
      updatedAt: input.nowIso,
    };
    this.mappings.set(key, mapping);
    return { ok: true as const, value: mapping };
  }

  async updateTaskSyncState(
    _actor: AuthenticatedActor,
    input: { taskId: string; eventId: string | null },
  ) {
    const row = this.tasks.get(input.taskId);
    if (row) {
      this.tasks.set(input.taskId, { ...row, calendarEventId: input.eventId });
    }
    return { ok: true as const, value: undefined };
  }

  async updateRunItem(
    _actor: AuthenticatedActor,
    input: {
      runId: string;
      taskId: string;
      outcome: CalendarSyncItemOutcome;
      exclusionReason: CalendarRunItemDraft["exclusionReason"];
      eventId: string | null;
      payloadHash: string | null;
      errorMessage?: string | null;
    },
  ) {
    const items = this.runItems(input.runId);
    const next = items.map((item) =>
      item.taskId === input.taskId
        ? {
            ...item,
            outcome: input.outcome,
            exclusionReason: input.exclusionReason,
            eventId: input.eventId,
            payloadHash: input.payloadHash,
            errorMessage: input.errorMessage ?? null,
          }
        : item,
    );
    this.items.set(input.runId, next);
    return { ok: true as const, value: undefined };
  }

  async countPendingRunJobs(_actor: AuthenticatedActor, runId: string) {
    return {
      ok: true as const,
      value: [...this.jobs.values()].filter(
        (job) => job.runId === runId && ["pending", "processing"].includes(job.status),
      ).length,
    };
  }

  async completeRunIfDrained(
    _actor: AuthenticatedActor,
    input: { runId: string; nowIso: string },
  ) {
    const run = this.runs.get(input.runId);
    if (!run) return { ok: true as const, value: null };
    if (!run.scanComplete) return { ok: true as const, value: run };
    const pending = [...this.jobs.values()].filter(
      (job) => job.runId === run.id && ["pending", "processing"].includes(job.status),
    );
    if (pending.length > 0) return { ok: true as const, value: run };
    const completed = {
      ...run,
      status: "completed" as const,
      completedAt: input.nowIso,
      updatedAt: input.nowIso,
    };
    this.runs.set(run.id, completed);
    return { ok: true as const, value: completed };
  }

  async listActiveRuns() {
    return { ok: true as const, value: [] as CalendarRunRecord[] };
  }

  async listReadyDestinations(): Promise<{ ok: true; value: CalendarReadyQueue[] }> {
    const destinations = new Map<string, CalendarReadyQueue>();
    for (const job of this.jobs.values()) {
      if (job.status !== "pending") continue;
      const key = `${job.ownerUserId}|${job.destination.destinationKey}`;
      if (!destinations.has(key)) {
        destinations.set(key, {
          ownerUserId: job.ownerUserId,
          destination: job.destination,
        });
      }
    }
    return { ok: true, value: [...destinations.values()] };
  }
}

function buildDeps(repository: FakeRepository, provider: FakeProvider) {
  return {
    repository,
    provider,
    config: {
      linkBaseUrl: "https://ega.example",
      scanPageSize: 10,
      jobLimit: 10,
      requestBudgetMs: 5_000,
      leaseSeconds: 60,
    },
    now: () => new Date("2026-05-10T08:00:00.000Z"),
  };
}

test("Calendar publication plans timed, all-day, and explicit exclusions", () => {
  assert.deepEqual(planCalendarTaskEvent(task()), {
    kind: "timed",
    start: { dateTime: "2026-05-10T09:00:00.000Z" },
    end: { dateTime: "2026-05-10T10:00:00.000Z" },
    exclusionReason: null,
  });

  assert.deepEqual(
    planCalendarTaskEvent(
      task({
        scheduledStartAt: null,
        scheduledEndAt: null,
        plannedForDate: "2026-05-10",
      }),
    ),
    {
      kind: "all_day",
      start: { date: "2026-05-10" },
      end: { date: "2026-05-11" },
      exclusionReason: null,
    },
  );

  assert.equal(
    planCalendarTaskEvent(
      task({ calendarSyncEnabled: false }),
    ).exclusionReason,
    "opted_out",
  );
  assert.equal(
    planCalendarTaskEvent(
      task({
        scheduledStartAt: null,
        scheduledEndAt: null,
        dueDate: "2026-05-10",
      }),
    ).exclusionReason,
    "deadline_only",
  );
  assert.equal(
    planCalendarTaskEvent(
      task({
        scheduledStartAt: null,
        scheduledEndAt: null,
      }),
    ).exclusionReason,
    "undated",
  );
  assert.equal(
    planCalendarTaskEvent(
      task({ scheduledEndAt: null }),
    ).exclusionReason,
    "incomplete_time_block",
  );
  assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
});

test("manual sync publishes deterministic once and reports unchanged on repeat", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  const deps = buildDeps(repository, provider);

  const first = await startCalendarSync(actor, deps);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  assert.equal(provider.createCalls, 1);
  assert.equal(provider.updateCalls, 0);
  assert.equal(first.data.run?.counts.created, 1);
  assert.equal(provider.events.size, 1);

  const event = [...provider.events.values()][0];
  assert.equal(event.privateProperties.source, "ega-house");
  assert.equal(event.privateProperties.task_id, "task-1");
  assert.ok(event.privateProperties.payload_hash);

  const second = await startCalendarSync(actor, deps);
  assert.equal(second.ok, true);
  if (!second.ok) return;

  assert.equal(provider.createCalls, 1);
  assert.equal(provider.updateCalls, 0);
  assert.equal(second.data.run?.counts.unchanged, 1);
  assert.equal(provider.events.size, 1);
});

test("manual sync removes a completed task event and keeps zero active events", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  const deps = buildDeps(repository, provider);

  await startCalendarSync(actor, deps);
  assert.equal(provider.events.size, 1);

  repository.addTask(
    task({
      status: "done",
      completedAt: "2026-05-10T11:00:00.000Z",
      updatedAt: "2026-05-10T11:00:00.000Z",
    }),
  );

  const result = await startCalendarSync(actor, deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(provider.deleteCalls, 1);
  assert.equal(provider.events.size, 0);
  assert.equal(result.data.run?.counts.removed, 1);
});

test("archived task removal retires the mapping, then republishes one new generation", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  const deps = buildDeps(repository, provider);

  await startCalendarSync(actor, deps);
  const original = [...provider.events.values()][0];
  assert.ok(original);
  const archivedAt = "2026-05-10T11:00:00.000Z";
  repository.addTask(
    task({
      status: "done",
      completedAt: archivedAt,
      updatedAt: archivedAt,
    }),
  );

  const removed = await startCalendarSync(actor, deps);
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.equal(provider.deleteCalls, 1);
  assert.equal(provider.events.size, 0);
  assert.equal(removed.data.run?.counts.removed, 1);
  assert.equal(
    [...repository.mappings.values()][0]?.status,
    "removed",
    "the archive delete must retire the mapping only after Google confirms removal",
  );

  const stillArchived = await startCalendarSync(actor, deps);
  assert.equal(stillArchived.ok, true);
  if (!stillArchived.ok) return;
  assert.equal(
    provider.deleteCalls,
    1,
    "an archived task with no active mapping must not queue another delete",
  );
  assert.equal(stillArchived.data.run?.counts.excluded, 1);

  repository.addTask(task({ updatedAt: "2026-05-10T12:00:00.000Z" }));
  const republished = await startCalendarSync(actor, deps);
  assert.equal(republished.ok, true);
  assert.equal(provider.events.size, 1);
  const replacement = [...provider.events.values()][0];
  assert.notEqual(replacement.id, original.id);
  assert.equal(replacement.privateProperties.generation, "2");
  assert.equal([...repository.mappings.values()][0]?.status, "active");
  assert.equal([...repository.mappings.values()][0]?.generation, 2);
});

test("failed orphan enqueue keeps the mapping active and a retry removes the event", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  const deps = buildDeps(repository, provider);

  await startCalendarSync(actor, deps);
  assert.equal(provider.events.size, 1);
  repository.tasks.delete("task-1");
  repository.failNextOrphanDeleteCommit = true;

  const interrupted = await startCalendarSync(actor, deps);
  assert.equal(interrupted.ok, true);
  assert.equal(provider.events.size, 1, "the Google event must still exist");
  assert.equal(
    [...repository.mappings.values()][0]?.status,
    "active",
    "a failed orphan enqueue must not retire the mapping before the delete job is durable",
  );
  assert.equal(
    [...repository.jobs.values()].filter((job) => job.operation === "delete").length,
    0,
  );

  const retried = await startCalendarSync(actor, deps);
  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal(provider.deleteCalls, 1);
  assert.equal(provider.events.size, 0);
  assert.equal([...repository.mappings.values()][0]?.status, "removed");
  assert.equal(retried.data.run?.counts.removed, 1);
});

test("a stale delete completion cannot retire a newer mapping generation", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  const deps = buildDeps(repository, provider);

  await startCalendarSync(actor, deps);
  const original = [...provider.events.values()][0];
  assert.ok(original);

  // A republish completed after the delete was queued: the mapping now points
  // at generation 2 while the queued delete still targets generation 1.
  const republishedEventId = "event-generation-2";
  provider.events.delete(original.id);
  provider.events.set(republishedEventId, {
    id: republishedEventId,
    status: "confirmed",
    summary: "Republished",
    start: { dateTime: "2026-05-10T09:00:00.000Z" },
    end: { dateTime: "2026-05-10T10:00:00.000Z" },
    privateProperties: {
      source: "ega-house",
      task_id: "task-1",
      owner_user_id: actor.userId,
      destination_key: destination.destinationKey,
      generation: "2",
    },
    raw: {},
  });
  const key = `${actor.userId}|task-1|${destination.destinationKey}`;
  const previous = repository.mappings.get(key);
  assert.ok(previous);
  repository.mappings.set(key, {
    ...previous,
    eventId: republishedEventId,
    generation: 2,
    status: "active",
  });
  repository.jobs.set("stale-delete", {
    id: "stale-delete",
    ownerUserId: actor.userId,
    taskId: "task-1",
    runId: null,
    destination,
    operation: "delete",
    status: "pending",
    attempts: 0,
    eventId: original.id,
    generation: 1,
    eventExists: true,
    payloadHash: null,
    claimToken: null,
    permanentFailure: false,
    exclusionReason: null,
    lastError: null,
    scheduledAt: "2026-05-10T08:00:00.000Z",
    taskUpdatedAt: "2026-05-10T08:00:00.000Z",
  });

  const result = await processCalendarRecovery(actor, deps);
  assert.equal(result.ok, true);
  assert.equal(provider.events.has(original.id), false);
  assert.equal(provider.events.has(republishedEventId), true);
  assert.equal(repository.mappings.get(key)?.status, "active");
  assert.equal(repository.mappings.get(key)?.generation, 2);
  assert.equal(repository.jobs.get("stale-delete")?.status, "succeeded");
});

test("manual sync excludes deadline-only tasks with a visible reason", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(
    task({
      scheduledStartAt: null,
      scheduledEndAt: null,
      dueDate: "2026-05-12",
    }),
  );

  const result = await startCalendarSync(actor, buildDeps(repository, provider));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.run?.counts.excluded, 1);
  assert.deepEqual(result.data.run?.exclusions, [
    { reason: "deadline_only", count: 1 },
  ]);
  assert.equal(provider.createCalls, 0);
});

test("a failed managed-event listing never infers deletion or writes removals", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  const deps = buildDeps(repository, provider);

  await startCalendarSync(actor, deps);
  assert.equal(provider.events.size, 1);

  provider.nextListFailure = {
    kind: "retryable",
    message: "Calendar listing failed.",
  };
  const result = await startCalendarSync(actor, deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(provider.deleteCalls, 0);
  assert.equal(provider.events.size, 1);
});

test("a queued job bound to another destination is never sent through the new connection", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  const deps = buildDeps(repository, provider);

  await startCalendarSync(actor, deps);
  const run = [...repository.runs.values()][0];

  // Simulate a queued coalesced update that was created for a different
  // Google account before the destination switched.
  repository.jobs.set("stale-job", {
    id: "stale-job",
    ownerUserId: actor.userId,
    taskId: "task-1",
    runId: run.id,
    destination: {
      accountSubject: "old-google-subject",
      accountEmail: "old@example.com",
      calendarId: "primary",
      destinationKey: "old-google-subject|primary",
    },
    operation: "upsert",
    status: "pending",
    attempts: 0,
    eventId: null,
    generation: 1,
    eventExists: false,
    payloadHash: null,
    claimToken: null,
    permanentFailure: false,
    exclusionReason: null,
    lastError: null,
    scheduledAt: "2026-05-10T08:00:00.000Z",
    taskUpdatedAt: "2026-05-10T08:00:00.000Z",
  });

  repository.runs.set(run.id, { ...run, status: "active" });
  const before = provider.events.size;
  const result = await continueCalendarSync(actor, deps, run.id);
  assert.equal(result.ok, true);

  assert.equal(provider.events.size, before);
  assert.equal(repository.jobs.get("stale-job")?.status, "failed");
  assert.equal(repository.jobs.get("stale-job")?.permanentFailure, true);
});

test("status hydration exposes the current run and paused destination message", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  const deps = buildDeps(repository, provider);

  await startCalendarSync(actor, deps);
  const status = await getCalendarSyncStatus(actor, deps);
  assert.equal(status.ok, true);
  if (!status.ok) return;

  assert.equal(status.data.connection.connected, true);
  assert.equal(status.data.run?.counts.created, 1);
  assert.equal(status.data.run?.hasMore, false);
});

test("external deletion advances the generation and leaves exactly one replacement event", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  const deps = buildDeps(repository, provider);

  await startCalendarSync(actor, deps);
  const original = [...provider.events.values()][0];
  assert.ok(original);

  provider.events.delete(original.id);

  const result = await startCalendarSync(actor, deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(provider.getCalls, 1, "absence is confirmed by a targeted lookup");
  assert.equal(provider.events.size, 1);
  const replacement = [...provider.events.values()][0];
  assert.notEqual(replacement.id, original.id);
  assert.equal(replacement.privateProperties.generation, "2");
  assert.equal(result.data.run?.counts.created, 1);
});

test("a live mapped event with a missing source tag keeps its id and generation", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  const deps = buildDeps(repository, provider);

  await startCalendarSync(actor, deps);
  const original = [...provider.events.values()][0];
  assert.ok(original);

  // The event still exists in the verified destination, but its EGA House
  // source tag is gone, so the tag-filtered listing omits it.
  provider.events.set(original.id, { ...original, privateProperties: {} });

  const result = await startCalendarSync(actor, deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.run?.counts.updated, 1);
  assert.equal(provider.events.size, 1, "no duplicate event may be created");
  const repaired = provider.events.get(original.id);
  assert.equal(repaired?.privateProperties.source, "ega-house");
  assert.equal(repaired?.privateProperties.task_id, "task-1");
  assert.equal(repaired?.privateProperties.generation, "1");
  assert.equal(provider.createCalls, 1);
  assert.equal(provider.getCalls, 1);

  const mapping = [...repository.mappings.values()][0];
  assert.equal(mapping?.eventId, original.id);
  assert.equal(mapping?.generation, 1);
  assert.equal(mapping?.status, "active");

  const stable = await startCalendarSync(actor, deps);
  assert.equal(stable.ok, true);
  if (!stable.ok) return;
  assert.equal(stable.data.run?.counts.unchanged, 1);
  assert.equal(provider.createCalls, 1);
  assert.equal(provider.updateCalls, 1);
});

for (const kind of ["retryable", "permanent"] as const) {
  test(`an ambiguous ${kind} lookup preserves the live event and active mapping`, async () => {
    const repository = new FakeRepository();
    const provider = new FakeProvider();
    repository.addTask(task());
    const deps = buildDeps(repository, provider);

    await startCalendarSync(actor, deps);
    const original = [...provider.events.values()][0];
    assert.ok(original);
    provider.events.set(original.id, { ...original, privateProperties: {} });

    provider.nextGetFailure = {
      kind,
      message: "Google Calendar could not verify the saved event.",
    };

    const result = await startCalendarSync(actor, deps);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.data.run?.counts.failed, 1);
    assert.equal(provider.createCalls, 1);
    assert.equal(provider.updateCalls, 0);
    assert.equal(provider.deleteCalls, 0);
    assert.equal(provider.events.size, 1);
    assert.deepEqual(
      provider.events.get(original.id)?.privateProperties,
      {},
      "an ambiguous lookup must not mutate the live event",
    );

    const mapping = [...repository.mappings.values()][0];
    assert.equal(mapping?.eventId, original.id);
    assert.equal(mapping?.generation, 1);
    assert.equal(mapping?.status, "active");

    const failedItem = [...repository.items.values()]
      .flat()
      .find((item) => item.outcome === "failed");
    assert.match(
      String(failedItem?.errorMessage),
      /could not be verified in Google Calendar/,
    );
  });
}

test("timed to all-day to timed updates the same event id and replaces both boundaries", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  const deps = buildDeps(repository, provider);

  await startCalendarSync(actor, deps);
  const originalId = [...provider.events.keys()][0];

  repository.addTask(
    task({
      scheduledStartAt: null,
      scheduledEndAt: null,
      plannedForDate: "2026-05-10",
      updatedAt: "2026-05-10T09:01:00.000Z",
    }),
  );
  const allDay = await startCalendarSync(actor, deps);
  assert.equal(allDay.ok, true);
  const allDayEvent = provider.events.get(originalId);
  assert.deepEqual(allDayEvent?.start, { date: "2026-05-10" });
  assert.deepEqual(allDayEvent?.end, { date: "2026-05-11" });
  assert.equal(provider.events.size, 1);

  repository.addTask(
    task({ updatedAt: "2026-05-10T09:02:00.000Z" }),
  );
  const timed = await startCalendarSync(actor, deps);
  assert.equal(timed.ok, true);
  const timedEvent = provider.events.get(originalId);
  assert.deepEqual(timedEvent?.start, {
    dateTime: "2026-05-10T09:00:00.000Z",
  });
  assert.deepEqual(timedEvent?.end, {
    dateTime: "2026-05-10T10:00:00.000Z",
  });
  assert.equal(provider.events.size, 1);
});

test("legacy saved event id is updated in place and acquires private metadata", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(
    task({
      calendarEventId: "legacy-event-1",
      updatedAt: "2026-05-10T09:00:00.000Z",
    }),
  );
  // The current destination's source-tagged listing is the positive evidence
  // that this saved id belongs here; no mapping history is needed.
  provider.events.set("legacy-event-1", {
    id: "legacy-event-1",
    status: "confirmed",
    summary: "Old title",
    start: { dateTime: "2026-05-10T09:00:00.000Z" },
    end: { dateTime: "2026-05-10T10:00:00.000Z" },
    privateProperties: {
      source: "ega-house",
      task_id: "task-1",
      owner_user_id: actor.userId,
      destination_key: destination.destinationKey,
    },
    raw: {},
  });

  const deps = buildDeps(repository, provider);
  const first = await startCalendarSync(actor, deps);
  assert.equal(first.ok, true);

  assert.equal(provider.createCalls, 0);
  assert.equal(provider.updateCalls, 1);
  const adopted = provider.events.get("legacy-event-1");
  assert.equal(adopted?.privateProperties.source, "ega-house");
  assert.equal(adopted?.privateProperties.task_id, "task-1");

  const second = await startCalendarSync(actor, deps);
  assert.equal(second.ok, true);
  assert.equal(provider.updateCalls, 1);
  if (!second.ok) return;
  assert.equal(second.data.run?.counts.unchanged, 1);
});

test("a source-only event tag never adopts an unscoped saved event id for an update", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(
    task({
      calendarEventId: "source-only-event",
      updatedAt: "2026-05-10T09:00:00.000Z",
    }),
  );
  // The listing filters by the source tag, so this event is visible, but a
  // source-only tag does not say which task, owner or destination owns it.
  provider.events.set("source-only-event", {
    id: "source-only-event",
    status: "confirmed",
    summary: "Old title",
    start: { dateTime: "2026-05-10T09:00:00.000Z" },
    end: { dateTime: "2026-05-10T10:00:00.000Z" },
    privateProperties: { source: "ega-house" },
    raw: {},
  });

  const deps = buildDeps(repository, provider);
  const result = await startCalendarSync(actor, deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(
    {
      create: provider.createCalls,
      update: provider.updateCalls,
      delete: provider.deleteCalls,
    },
    { create: 0, update: 0, delete: 0 },
  );
  assert.equal(provider.events.get("source-only-event")?.summary, "Old title");
  assert.equal(repository.jobs.size, 0);
  assert.equal(repository.mappings.size, 0);
  assert.equal(
    repository.tasks.get("task-1")?.calendarEventId,
    "source-only-event",
  );
  assert.equal(result.data.run?.counts.failed, 1);

  const item = [...repository.items.values()].flat()[0];
  assert.equal(item?.eventId, null);
  assert.match(String(item?.errorMessage), /different Google account or calendar/);
});

test("a source-only event tag never deletes an unscoped saved event id", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(
    task({
      calendarEventId: "source-only-excluded-event",
      calendarSyncEnabled: false,
    }),
  );
  provider.events.set("source-only-excluded-event", {
    id: "source-only-excluded-event",
    status: "confirmed",
    summary: "Old title",
    start: { dateTime: "2026-05-10T09:00:00.000Z" },
    end: { dateTime: "2026-05-10T10:00:00.000Z" },
    privateProperties: { source: "ega-house" },
    raw: {},
  });

  const result = await startCalendarSync(actor, buildDeps(repository, provider));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // Without explicit task/owner/destination metadata the source tag alone
  // cannot prove the event belongs to this task, so removal is blocked.
  assert.equal(provider.deleteCalls, 0);
  assert.equal(provider.createCalls, 0);
  assert.equal(provider.updateCalls, 0);
  assert.equal(provider.events.has("source-only-excluded-event"), true);
  assert.equal(repository.jobs.size, 0);
  assert.equal(result.data.run?.counts.excluded, 1);
});

test("unmapped deterministic-id conflict is reported and the foreign event is untouched", async () => {
  const { deterministicCalendarEventId } = await import(
    "@ega/application/calendar-sync/rules"
  );
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  const deps = buildDeps(repository, provider);

  const eventId = deterministicCalendarEventId({
    ownerUserId: actor.userId,
    taskId: "task-1",
    destinationKey: destination.destinationKey,
    generation: 1,
  });
  provider.events.set(eventId, {
    id: eventId,
    status: "confirmed",
    summary: "Someone else's event",
    start: { dateTime: "2026-05-10T09:00:00.000Z" },
    end: { dateTime: "2026-05-10T10:00:00.000Z" },
    privateProperties: {
      source: "ega-house",
      task_id: "different-task",
      owner_user_id: actor.userId,
      destination_key: destination.destinationKey,
    },
    raw: {},
  });

  const result = await startCalendarSync(actor, deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.run?.counts.failed, 1);
  assert.equal(provider.events.get(eventId)?.summary, "Someone else's event");
  assert.equal(provider.updateCalls, 0);
});

test("a switched destination never adopts the previous destination's saved event id", async () => {
  const repository = new FakeRepository();
  const providerA = new FakeProvider();
  repository.addTask(task());
  const first = await startCalendarSync(actor, buildDeps(repository, providerA));
  assert.equal(first.ok, true);

  const mappingA = [...repository.mappings.values()][0];
  assert.ok(mappingA);
  const savedEventId = repository.tasks.get("task-1")?.calendarEventId;
  assert.equal(savedEventId, mappingA.eventId);
  const writesBefore = {
    create: providerA.createCalls,
    update: providerA.updateCalls,
    remove: providerA.deleteCalls,
  };

  const providerB = new FakeProvider();
  repository.connection = {
    ...repository.connection,
    accountSubject: "google-subject-2",
    accountEmail: "new@example.com",
    destinationKey: "new@example.com|primary",
    updatedAt: "2026-05-11T00:00:00.000Z",
  };

  const switched = await startCalendarSync(actor, buildDeps(repository, providerB));
  assert.equal(switched.ok, true);
  if (!switched.ok) return;

  // The previous account's event id is not adopted or written through the new
  // account. The task is reported as paused for explicit reconciliation.
  assert.deepEqual(
    {
      create: providerB.createCalls,
      update: providerB.updateCalls,
      remove: providerB.deleteCalls,
    },
    { create: 0, update: 0, remove: 0 },
  );
  assert.deepEqual(
    {
      create: providerA.createCalls,
      update: providerA.updateCalls,
      remove: providerA.deleteCalls,
    },
    writesBefore,
  );
  assert.equal(repository.tasks.get("task-1")?.calendarEventId, savedEventId);
  assert.equal(switched.data.run?.counts.failed, 1);

  const runB = [...repository.runs.values()].find(
    (run) => run.destination.destinationKey === "new@example.com|primary",
  );
  assert.ok(runB);
  const item = repository.items.get(runB.id)?.[0];
  assert.equal(item?.outcome, "failed");
  assert.match(String(item?.errorMessage), /different Google account or calendar/);
  assert.equal(
    [...repository.mappings.values()].filter(
      (mapping) => mapping.destination.destinationKey === "new@example.com|primary",
    ).length,
    0,
  );
});

test("a first sync under a new account never targets an absent legacy event id", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.connection = {
    ...repository.connection,
    accountSubject: "google-subject-2",
    accountEmail: "new@example.com",
    destinationKey: "new@example.com|primary",
    updatedAt: "2026-05-11T00:00:00.000Z",
  };
  const accountAEventId = "account-a-legacy-event";
  repository.addTask(task({ calendarEventId: accountAEventId }));
  // Account A's event is absent from B's listing and the task has no mapping
  // history. Neither fact proves the unscoped id belongs to B.

  const result = await startCalendarSync(actor, buildDeps(repository, provider));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(
    {
      create: provider.createCalls,
      update: provider.updateCalls,
      delete: provider.deleteCalls,
    },
    { create: 0, update: 0, delete: 0 },
  );
  assert.equal(provider.events.has(accountAEventId), false);
  assert.equal(repository.jobs.size, 0);
  assert.equal(repository.mappings.size, 0);
  assert.equal(repository.tasks.get("task-1")?.calendarEventId, accountAEventId);
  assert.equal(result.data.run?.counts.failed, 1);

  const runB = [...repository.runs.values()].find(
    (run) => run.destination.destinationKey === "new@example.com|primary",
  );
  assert.ok(runB);
  const item = repository.items.get(runB.id)?.[0];
  assert.equal(item?.outcome, "failed");
  assert.equal(item?.eventId, null);
  assert.match(String(item?.errorMessage), /different Google account or calendar/);
});

test("an excluded task never deletes another account's listed legacy event", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.connection = {
    ...repository.connection,
    accountSubject: "google-subject-2",
    accountEmail: "new@example.com",
    destinationKey: "new@example.com|primary",
    updatedAt: "2026-05-11T00:00:00.000Z",
  };
  const accountAEventId = "account-a-excluded-event";
  provider.events.set(accountAEventId, {
    id: accountAEventId,
    status: "confirmed",
    summary: "Account A event",
    start: { dateTime: "2026-05-10T09:00:00.000Z" },
    end: { dateTime: "2026-05-10T10:00:00.000Z" },
    privateProperties: {
      source: "ega-house",
      task_id: "task-1",
      owner_user_id: actor.userId,
      destination_key: "owner@example.com|primary",
    },
    raw: {},
  });
  repository.addTask(
    task({ calendarEventId: accountAEventId, calendarSyncEnabled: false }),
  );

  const result = await startCalendarSync(actor, buildDeps(repository, provider));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // The id exists in B's source-tagged listing, but its metadata says it
  // belongs to A. Existence alone must not authorize a delete through B.
  assert.equal(provider.deleteCalls, 0);
  assert.equal(provider.createCalls, 0);
  assert.equal(provider.updateCalls, 0);
  assert.equal(provider.events.get(accountAEventId)?.summary, "Account A event");
  assert.equal(repository.jobs.size, 0);
  assert.equal(repository.tasks.get("task-1")?.calendarEventId, accountAEventId);
  assert.equal(result.data.run?.counts.excluded, 1);
});

test("a saved event id is adopted when its metadata proves the current destination", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.connection = {
    ...repository.connection,
    accountSubject: "google-subject-2",
    accountEmail: "new@example.com",
    destinationKey: "new@example.com|primary",
    updatedAt: "2026-05-11T00:00:00.000Z",
  };
  const ownedEventId = "account-b-owned-event";
  provider.events.set(ownedEventId, {
    id: ownedEventId,
    status: "confirmed",
    summary: "Old title",
    start: { dateTime: "2026-05-10T09:00:00.000Z" },
    end: { dateTime: "2026-05-10T10:00:00.000Z" },
    privateProperties: {
      source: "ega-house",
      task_id: "task-1",
      owner_user_id: actor.userId,
      destination_key: "new@example.com|primary",
      generation: "1",
    },
    raw: {},
  });
  repository.addTask(task({ calendarEventId: ownedEventId }));

  const result = await startCalendarSync(actor, buildDeps(repository, provider));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(provider.createCalls, 0);
  assert.equal(provider.updateCalls, 1);
  assert.equal(provider.deleteCalls, 0);
  const mapping = [...repository.mappings.values()][0];
  assert.equal(mapping?.eventId, ownedEventId);
  assert.equal(
    mapping?.destination.destinationKey,
    "new@example.com|primary",
  );
  assert.equal(provider.events.get(ownedEventId)?.privateProperties.task_id, "task-1");
});

test("a missing task cannot delete an unowned planned event", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  const eventId = deterministicCalendarEventId({
    ownerUserId: actor.userId, taskId: "task-1",
    destinationKey: destination.destinationKey, generation: 1,
  });
  provider.events.set(eventId, {
    id: eventId, status: "confirmed", summary: "Foreign",
    start: { dateTime: "2026-05-10T09:00:00.000Z" },
    end: { dateTime: "2026-05-10T10:00:00.000Z" }, privateProperties: {}, raw: {},
  });
  repository.jobs.set("scheduled", {
    id: "scheduled", ownerUserId: actor.userId, taskId: "task-1", runId: null,
    destination, operation: "delete", status: "pending", attempts: 0,
    eventId, generation: 1, eventExists: false, payloadHash: null,
    claimToken: null, permanentFailure: false, exclusionReason: null,
    lastError: null, scheduledAt: "2026-05-10T08:00:00.000Z",
    taskUpdatedAt: "2026-05-10T08:00:00.000Z",
  });
  await processCalendarRecovery(actor, buildDeps(repository, provider));
  assert.equal(provider.deleteCalls, 0);
  assert.equal(provider.events.get(eventId)?.summary, "Foreign");
});

test("recovery retries a provider success after atomic settlement fails", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.addTask(task());
  repository.jobs.set("scheduled", {
    id: "scheduled", ownerUserId: actor.userId, taskId: "task-1", runId: null,
    destination, operation: "upsert", status: "pending", attempts: 0,
    eventId: null, generation: 1, eventExists: false, payloadHash: null,
    claimToken: null, permanentFailure: false, exclusionReason: null,
    lastError: null, scheduledAt: "2026-05-10T08:00:00.000Z",
    taskUpdatedAt: "2026-05-10T08:00:00.000Z",
  });
  repository.failNextCompletion = true;
  await processCalendarRecovery(actor, buildDeps(repository, provider));
  assert.equal(provider.events.size, 1);
  assert.equal(repository.mappings.size, 0);
  const first = repository.jobs.get("scheduled")!;
  assert.equal(first.status, "processing");
  repository.jobs.set(first.id, { ...first, status: "pending", claimToken: null });
  await processCalendarRecovery(actor, buildDeps(repository, provider));
  assert.equal(provider.events.size, 1);
  assert.equal(repository.mappings.size, 1);
  assert.equal(repository.jobs.get("scheduled")?.status, "succeeded");
  assert.equal(provider.createCalls, 2);
});

test("recovery removes an unsettled first publish and republishes under a new ID when restored", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  provider.retainDeletedEventIds = true;
  const deps = buildDeps(repository, provider);
  repository.addTask(task());
  repository.jobs.set("scheduled", {
    id: "scheduled", ownerUserId: actor.userId, taskId: "task-1", runId: null,
    destination, operation: "upsert", status: "pending", attempts: 0,
    eventId: null, generation: 1, eventExists: false, payloadHash: null,
    claimToken: null, permanentFailure: false, exclusionReason: null,
    lastError: null, scheduledAt: "2026-05-10T08:00:00.000Z",
    taskUpdatedAt: "2026-05-10T08:00:00.000Z",
  });
  repository.failNextCompletion = true;
  await processCalendarRecovery(actor, deps);
  assert.equal(provider.events.size, 1);
  const [originalId] = provider.events.keys();
  assert.equal(repository.mappings.size, 0);
  const first = repository.jobs.get("scheduled")!;
  assert.equal(first.status, "processing");
  repository.jobs.set(first.id, { ...first, status: "pending", claimToken: null });
  repository.addTask(task({ archivedAt: "2026-05-10T08:30:00.000Z" }));
  await processCalendarRecovery(actor, deps);
  assert.equal(provider.events.size, 0);
  assert.equal(provider.deleteCalls, 1);
  assert.equal(repository.jobs.get("scheduled")?.status, "succeeded");
  assert.equal([...repository.mappings.values()][0]?.status, "removed");

  repository.addTask(task({ updatedAt: "2026-05-10T12:00:00.000Z" }));
  const republished = await startCalendarSync(actor, deps);
  assert.equal(republished.ok, true);
  assert.equal(provider.events.size, 1, "restoring must publish one active event");
  const [replacement] = provider.events.values();
  assert.notEqual(replacement.id, originalId);
  assert.equal(replacement.privateProperties.generation, "2");
  assert.equal(provider.updateCalls, 0);
});

test("recovery leaves another destination's queued job pending after an account switch", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.connection = {
    ...repository.connection,
    accountSubject: "google-subject-2",
    accountEmail: "new@example.com",
    destinationKey: "new@example.com|primary",
    updatedAt: "2026-05-11T00:00:00.000Z",
  };
  repository.jobs.set("old-account-job", {
    id: "old-account-job",
    ownerUserId: actor.userId,
    taskId: "task-1",
    runId: null,
    destination: {
      accountSubject: "google-subject-1",
      accountEmail: "owner@example.com",
      calendarId: "primary",
      destinationKey: "owner@example.com|primary",
    },
    operation: "upsert",
    status: "pending",
    attempts: 0,
    eventId: null,
    generation: 1,
    eventExists: false,
    payloadHash: null,
    claimToken: null,
    permanentFailure: false,
    exclusionReason: null,
    lastError: null,
    scheduledAt: "2026-05-10T08:00:00.000Z",
    taskUpdatedAt: "2026-05-10T08:00:00.000Z",
  });
  repository.addTask(task());

  const result = await processCalendarRecovery(actor, buildDeps(repository, provider));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.data, {
    runsProcessed: 0,
    destinationsProcessed: 0,
    jobsProcessed: 0,
  });
  assert.equal(repository.jobs.get("old-account-job")?.status, "pending");
  assert.equal(repository.jobs.get("old-account-job")?.attempts, 0);
  assert.equal(
    provider.createCalls + provider.updateCalls + provider.deleteCalls,
    0,
  );
});

test("manual sync cannot start without a verified Google account identity", async () => {
  const repository = new FakeRepository();
  const provider = new FakeProvider();
  repository.connection = {
    ...repository.connection,
    accountSubject: null,
    accountEmail: null,
  };

  const result = await startCalendarSync(actor, buildDeps(repository, provider));
  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.reason, "calendar_identity_unverified");
  assert.equal(repository.runs.size, 0);
  assert.equal(provider.createCalls + provider.updateCalls + provider.deleteCalls, 0);
});
