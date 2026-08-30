import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import type { McpPrincipal } from "@/lib/mcp/principal";

/**
 * Leaf module for the real-client MCP E2E: in-memory persistence fakes and the
 * module-boundary mocks for `@ega/application` / `@ega/data-access`.
 *
 * IMPORTANT: this module must NOT import anything from the production MCP
 * graph (route-runtime, write-tool-handlers, web-transport-handler, …). The
 * vi.mock factories in mcp-real-v2-client.e2e.test.ts import THIS module; a
 * production-graph import here would re-enter the mocked module graph and
 * deadlock ESM evaluation.
 *
 * What is faked here (test boundary, documented):
 * - bearer token → McpPrincipal map instead of Supabase token verification
 *   (identity still derives only from the verified bearer token);
 * - an in-memory table store behind a minimal Supabase query-builder fake
 *   (select/eq/is/order/limit/insert/update/single/maybeSingle/rpc) sized to
 *   the exact query shapes the production handlers and repositories issue;
 *   RLS and the full fenced-ledger state machine (lease expiry, stale-token
 *   fencing, FAILED_FINAL) are not modeled here; they are proved against real
 *   Postgres by `scripts/db/mcp-receipt-invariant-verify.mjs`.
 * - `@ega/application` services and `@ega/data-access` repositories as
 *   store-backed fakes, vi.fn-wrapped so tests can assert canonical calls.
 */

export const OWNER_USER_IDS = {
  readOnly: "11111111-1111-4111-8111-111111111111",
  workspaceManager: "22222222-2222-4222-8222-222222222222",
  taskManager: "44444444-4444-4444-8444-444444444444",
};

export function principalForProfile(
  profile: McpPrincipal["permissionProfile"],
  ownerUserId: string,
): McpPrincipal {
  return {
    ownerUserId,
    oauthClientId: "e2e-mcp-client",
    grantId: "33333333-3333-4333-8333-333333333333",
    permissionProfile: profile,
    permissionsVersion: 1,
    permissions: getPermissionsForProfile(profile),
  };
}

export const E2E_PRINCIPALS: Record<string, McpPrincipal | undefined> = {
  "ro-token": principalForProfile("read_only", OWNER_USER_IDS.readOnly),
  // task_manager holds tasks.create/update but NOT projects.create — the only
  // profile whose write registry is reachable (any write permission registers
  // the write tools) while a specific write handler still denies. This is how
  // the handler-level PERMISSION_DENIED path is exercised through the wire.
  "tm-token": principalForProfile("task_manager", OWNER_USER_IDS.taskManager),
  "wm-token": principalForProfile("workspace_manager", OWNER_USER_IDS.workspaceManager),
  // Simulates a token whose grant lookup fails / is revoked. The production
  // verifier (verifyMcpHandlerToken) returns an AuthInfo with empty scopes
  // for this case (valid token, missing grant) which the auth wrapper
  // translates to 403 insufficient_scope — not 401 invalid_token.
  "revoked-token": undefined,
};

export function authInfoForToken(bearerToken: string): ReturnType<typeof createMcpAuthInfo> | undefined {
  const principal = E2E_PRINCIPALS[bearerToken];
  if (principal) return createMcpAuthInfo(bearerToken, principal);
  if (bearerToken === "revoked-token") {
    return {
      token: bearerToken,
      clientId: "e2e-mcp-client",
      scopes: [],
      extra: { ownerUserId: OWNER_USER_IDS.readOnly },
    } as unknown as ReturnType<typeof createMcpAuthInfo>;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// In-memory persistence fake
// ---------------------------------------------------------------------------

export type StoreRow = Record<string, unknown>;

export type RecordedMutation = {
  table: string;
  op: "insert" | "update";
  patch?: StoreRow;
  rowIds: unknown[];
};

export type RecordedRpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

export type McpE2eStore = {
  tables: Map<string, StoreRow[]>;
  mutations: RecordedMutation[];
  rpcCalls: RecordedRpcCall[];
  ledger: Map<string, { argsHash: string; claimToken: string; resultPayload?: StoreRow }>;
  seed: (table: string, row: StoreRow) => StoreRow;
};

function nowIso(): string {
  return new Date("2026-08-28T10:00:00.000Z").toISOString();
}

const TABLE_DEFAULTS: Record<string, () => StoreRow> = {
  projects: () => ({ id: randomUUID(), status: "active", created_at: nowIso(), updated_at: nowIso() }),
  goals: () => ({ id: randomUUID(), status: "draft", created_at: nowIso(), updated_at: nowIso() }),
  tasks: () => ({
    id: randomUUID(),
    status: "todo",
    priority: "medium",
    description: null,
    blocked_reason: null,
    estimate_minutes: null,
    focus_rank: null,
    due_date: null,
    planned_for_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    completed_at: null,
    archived_at: null,
    goal_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }),
  task_sessions: () => ({
    id: randomUUID(),
    ended_at: null,
    duration_seconds: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }),
};

export function createMcpE2eStore(): McpE2eStore {
  const tables = new Map<string, StoreRow[]>();
  const mutations: RecordedMutation[] = [];
  const rpcCalls: RecordedRpcCall[] = [];
  const ledger = new Map<string, { argsHash: string; claimToken: string; resultPayload?: StoreRow }>();

  return {
    tables,
    mutations,
    rpcCalls,
    ledger,
    seed(table, row) {
      const rows = tables.get(table) ?? [];
      const full = { ...(TABLE_DEFAULTS[table]?.() ?? {}), ...row };
      rows.push(full);
      tables.set(table, rows);
      return full;
    },
  };
}

type QueryState = {
  op: "select" | "insert" | "update";
  values: StoreRow | StoreRow[] | null;
  patch: StoreRow | null;
  eqFilters: Array<{ col: string; val: unknown }>;
  isFilters: Array<{ col: string; val: unknown }>;
  orders: Array<{ col: string; ascending: boolean }>;
  limit: number | null;
  select: string;
  single: boolean;
  maybeSingle: boolean;
};

function relationValue(
  store: McpE2eStore,
  row: StoreRow,
  relation: "projects" | "goals",
): unknown {
  const foreignKey = relation === "projects" ? "project_id" : "goal_id";
  const foreignId = row[foreignKey];
  if (typeof foreignId !== "string") return null;
  const table = store.tables.get(relation) ?? [];
  const foreignRow = table.find((candidate) => candidate.id === foreignId);
  if (!foreignRow) return null;
  return relation === "projects"
    ? { name: foreignRow.name ?? null }
    : { title: foreignRow.title ?? null };
}

function projectRow(store: McpE2eStore, row: StoreRow, select: string): StoreRow {
  const projected: StoreRow = { ...row };
  if (select.includes("projects")) projected.projects = relationValue(store, row, "projects");
  if (select.includes("goals") && select.includes("(")) projected.goals = relationValue(store, row, "goals");
  return projected;
}

function matchesFilters(state: QueryState, row: StoreRow): boolean {
  for (const filter of state.eqFilters) {
    if (row[filter.col] !== filter.val) return false;
  }
  for (const filter of state.isFilters) {
    if (row[filter.col] !== filter.val) return false;
  }
  return true;
}

export function createFakeSupabaseClient(
  store: McpE2eStore,
  accessToken: string,
): SupabaseClient<McpDatabase> {
  void accessToken;

  const from = (table: string) => {
    const state: QueryState = {
      op: "select",
      values: null,
      patch: null,
      eqFilters: [],
      isFilters: [],
      orders: [],
      limit: null,
      select: "*",
      single: false,
      maybeSingle: false,
    };

    const execute = async (): Promise<{ data: unknown; error: { message: string } | null }> => {
      const rows = store.tables.get(table) ?? [];
      if (state.op === "insert") {
        const inserts = Array.isArray(state.values) ? state.values : state.values ? [state.values] : [];
        const inserted: StoreRow[] = [];
        for (const values of inserts) {
          const row: StoreRow = { ...(TABLE_DEFAULTS[table]?.() ?? {}), ...values };
          rows.push(row);
          inserted.push(row);
        }
        store.tables.set(table, rows);
        store.mutations.push({ table, op: "insert", rowIds: inserted.map((row) => row.id) });
        return { data: state.single ? (inserted[0] ?? null) : inserted, error: null };
      }
      if (state.op === "update") {
        const matched = rows.filter((row) => matchesFilters(state, row));
        for (const row of matched) Object.assign(row, state.patch ?? {});
        store.mutations.push({
          table,
          op: "update",
          patch: { ...(state.patch ?? {}) },
          rowIds: matched.map((row) => row.id),
        });
        const data = matched.map((row) => projectRow(store, row, state.select));
        if (state.single) {
          return data.length === 1
            ? { data: data[0], error: null }
            : { data: null, error: { message: `Expected single row for ${table}, got ${data.length}` } };
        }
        if (state.maybeSingle) return { data: data[0] ?? null, error: null };
        return { data, error: null };
      }
      let out = rows
        .filter((row) => matchesFilters(state, row))
        .map((row) => projectRow(store, row, state.select));
      for (const order of [...state.orders].reverse()) {
        out = [...out].sort((a, b) => {
          const av = String(a[order.col]);
          const bv = String(b[order.col]);
          const cmp = av === bv ? 0 : av > bv ? 1 : -1;
          return order.ascending ? cmp : -cmp;
        });
      }
      if (state.limit !== null) out = out.slice(0, state.limit);
      if (state.single) {
        return out.length === 1
          ? { data: out[0], error: null }
          : { data: null, error: { message: `Expected single row for ${table}, got ${out.length}` } };
      }
      if (state.maybeSingle) return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    };

    const builder = {
      select(columns: string) {
        state.select = columns;
        return builder;
      },
      eq(col: string, val: unknown) {
        state.eqFilters.push({ col, val });
        return builder;
      },
      is(col: string, val: unknown) {
        state.isFilters.push({ col, val });
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        state.orders.push({ col, ascending: opts?.ascending !== false });
        return builder;
      },
      limit(count: number) {
        state.limit = count;
        return builder;
      },
      insert(values: StoreRow | StoreRow[]) {
        state.op = "insert";
        state.values = values;
        return builder;
      },
      update(patch: StoreRow) {
        state.op = "update";
        state.patch = patch;
        return builder;
      },
      single() {
        state.single = true;
        return builder;
      },
      maybeSingle() {
        state.maybeSingle = true;
        return builder;
      },
      then: (
        onFulfilled?: (value: { data: unknown; error: { message: string } | null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => execute().then(onFulfilled, onRejected),
    };
    return builder;
  };

  const rpc = (fn: string, args: Record<string, unknown>) => {
    store.rpcCalls.push({ fn, args });
    if (fn === "mcp_claim_mutation_receipt") {
      const key = `${String(args.p_tool_name)}:${String(args.p_operation_id)}`;
      const existing = store.ledger.get(key);
      if (!existing) {
        const claimToken = randomUUID();
        store.ledger.set(key, { argsHash: String(args.p_args_hash), claimToken });
        return Promise.resolve({ data: { claim_outcome: "CLAIM_GRANTED", claim_token: claimToken, existing_result: null }, error: null });
      }
      if (existing.argsHash !== String(args.p_args_hash)) {
        return Promise.resolve({ data: { claim_outcome: "CONFLICT", claim_token: null, existing_result: null }, error: null });
      }
      if (existing.resultPayload) {
        return Promise.resolve({ data: { claim_outcome: "REPLAY", claim_token: null, existing_result: existing.resultPayload }, error: null });
      }
      return Promise.resolve({ data: { claim_outcome: "IN_PROGRESS", claim_token: null, existing_result: null }, error: null });
    }
    if (fn === "mcp_store_mutation_result") {
      const key = `${String(args.p_tool_name)}:${String(args.p_operation_id)}`;
      const existing = store.ledger.get(key);
      if (existing && existing.claimToken === args.p_claim_token) existing.resultPayload = args.p_result_payload as StoreRow;
      return Promise.resolve({ data: null, error: null });
    }
    if (fn === "mcp_fail_mutation_result") return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: null });
  };

  return {
    from,
    rpc,
  } as unknown as SupabaseClient<McpDatabase>;
}

// ---------------------------------------------------------------------------
// Current-store slot shared with the vi.mock module factories
// ---------------------------------------------------------------------------

let currentStore: McpE2eStore | undefined;

export function setCurrentE2eStore(store: McpE2eStore | undefined): void {
  currentStore = store;
}

export function requireCurrentE2eStore(): McpE2eStore {
  if (!currentStore) throw new Error("E2E store not initialized; call createMcpE2eRuntime first.");
  return currentStore;
}

// ---------------------------------------------------------------------------
// vi.mock module factories (imported by the test file — leaf only, no cycle)
// ---------------------------------------------------------------------------

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function storeOk(values: StoreRow): { ok: true; values: StoreRow } {
  return { ok: true, values };
}

function storeData(data: unknown): { ok: true; data: unknown } {
  return { ok: true, data };
}

function ownedTask(ownerUserId: string, taskId: string): StoreRow | undefined {
  return (requireCurrentE2eStore().tables.get("tasks") ?? []).find(
    (row) => row.owner_user_id === ownerUserId && row.id === taskId,
  );
}

function taskRecord(row: StoreRow) {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string | null,
    blockedReason: row.blocked_reason as string | null,
    status: row.status as string,
    priority: row.priority as string,
    dueDate: row.due_date as string | null,
    estimateMinutes: row.estimate_minutes as number | null,
    projectId: row.project_id as string,
    goalId: row.goal_id as string | null,
    plannedForDate: row.planned_for_date as string | null,
    focusRank: row.focus_rank as number | null,
    archivedAt: row.archived_at as string | null,
    updatedAt: row.updated_at as string,
    reminders: [],
    recurrence: null,
  };
}

function timerRecord(row: StoreRow) {
  const task = typeof row.task_id === "string" ? ownedTask(row.owner_user_id as string, row.task_id) : undefined;
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    startedAt: row.started_at as string,
    endedAt: row.ended_at as string | null,
    durationSeconds: row.duration_seconds as number | null,
    taskTitle: (task?.title as string | undefined) ?? null,
  };
}

/**
 * Module mock for `@ega/application`.
 *
 * - `normalizeProjectSlug` must behave like the canonical slug normalizer; the
 *   production write handler dynamically imports it.
 * - Service fakes apply the equivalent effect to the in-memory store so
 *   behavior assertions stay meaningful if the lead-integrated write modules
 *   (apps/web/src/lib/mcp/write/*) route through `@ega/application`; they are
 *   vi.fn-wrapped so tests can assert canonical calls.
 */
export function buildApplicationModuleMock(): Record<string, unknown> {
  const store = () => requireCurrentE2eStore();

  const createProjectInApplication = vi.fn(
    (actor: { userId: string }, _repository: unknown, input: { name?: string; slug?: string; description?: string | null }) => {
      const row = store().seed("projects", {
        owner_user_id: actor.userId,
        name: input.name ?? "",
        slug: input.slug ?? "",
        description: input.description ?? null,
      });
      return Promise.resolve(storeOk({ name: row.name as string, slug: row.slug as string, description: row.description }));
    },
  );

  const createTaskInApplication = vi.fn(
    (actor: { userId: string }, _repository: unknown, input: StoreRow) => {
      const row = store().seed("tasks", {
        owner_user_id: actor.userId,
        project_id: input.projectId,
        goal_id: input.goalId ?? null,
        title: input.title ?? "",
        status: input.status ?? "todo",
        priority: input.priority ?? "medium",
      });
      return Promise.resolve(storeData(row));
    },
  );

  const clearCompletedTodayInApplication = vi.fn(
    (actor: { userId: string }, _repository: unknown, input: { date: string }) => {
      const rows = store().tables.get("tasks") ?? [];
      let cleared = 0;
      for (const row of rows) {
        if (
          row.owner_user_id === actor.userId
          && row.planned_for_date === input.date
          && row.status === "completed"
        ) {
          row.planned_for_date = null;
          cleared += 1;
        }
      }
      store().mutations.push({ table: "tasks", op: "update", patch: { planned_for_date: null }, rowIds: [] });
      return Promise.resolve(storeData({ clearedCount: cleared }));
    },
  );

  const planTaskForTodayInApplication = vi.fn(
    (actor: { userId: string }, _repository: unknown, input: { taskId: string; date: string }) => {
      const rows = store().tables.get("tasks") ?? [];
      const row = rows.find(
        (candidate) => candidate.owner_user_id === actor.userId && candidate.id === input.taskId,
      );
      if (!row) return Promise.resolve({ ok: false, errorMessage: "Task not found." });
      row.planned_for_date = input.date;
      return Promise.resolve(storeData(row));
    },
  );

  const startTaskSessionInApplication = vi.fn(
    (actor: { userId: string }, _repository: unknown, input: { taskId: string }) => {
      const row = store().seed("task_sessions", {
        owner_user_id: actor.userId,
        task_id: input.taskId,
        started_at: nowIso(),
      });
      return Promise.resolve(storeData(row));
    },
  );

  const stopTaskSessionInApplication = vi.fn(
    (actor: { userId: string }, _repository: unknown, input: { sessionId: string }) => {
      const rows = store().tables.get("task_sessions") ?? [];
      const row = rows.find(
        (candidate) => candidate.owner_user_id === actor.userId && candidate.id === input.sessionId,
      );
      if (!row) return Promise.resolve({ ok: false, errorMessage: "No open timer session." });
      row.ended_at = nowIso();
      row.duration_seconds = 0;
      return Promise.resolve(storeData(row));
    },
  );

  const getTodayPlanInApplication = vi.fn(
    async (
      actor: { userId: string },
      port: { listSelectedTasks: (actor: { userId: string }, date: string) => Promise<{ ok: boolean; value?: StoreRow[] }> },
      input: { date?: string },
    ) => {
      const date = input.date ?? nowIso().slice(0, 10);
      const selected = await port.listSelectedTasks(actor, date);
      return storeData({
        date,
        sections: [{ id: "selected", tasks: selected.value ?? [] }],
        suggestions: [],
        summary: {},
        activeTimer: null,
      });
    },
  );

  const notReachedService = (name: string) =>
    vi.fn(() => {
      throw new Error(`@ega/application mock: ${name} is not expected to be called by E2E scenarios`);
    });

  return {
    normalizeProjectSlug: (value: string) => slugify(value),
    createAuthenticatedActorFromIdentity: (identity: { id: string }) => ({ userId: identity.id }),
    createAuthenticatedActor: (identity: { userId?: string; id?: string }) => ({
      userId: identity.userId ?? identity.id,
    }),
    TIMER_ALREADY_RUNNING_MESSAGE: "A timer is already running.",
    TIMER_NO_OPEN_SESSION_MATCH_MESSAGE: "No open timer session matches.",
    TIMER_SESSION_NO_LONGER_RUNNING_MESSAGE: "The timer session is no longer running.",
    TIMER_TASK_UNAVAILABLE_MESSAGE: "The task is not available.",

    createProject: createProjectInApplication,
    updateProjectStatus: notReachedService("updateProjectStatus"),
    archiveProject: notReachedService("archiveProject"),
    unarchiveProject: notReachedService("unarchiveProject"),

    createGoal: notReachedService("createGoal"),
    updateGoalStatus: notReachedService("updateGoalStatus"),
    updateGoalHealth: notReachedService("updateGoalHealth"),
    updateGoalNextStep: notReachedService("updateGoalNextStep"),
    archiveGoal: notReachedService("archiveGoal"),
    unarchiveGoal: notReachedService("unarchiveGoal"),

    createTask: createTaskInApplication,
    updateTask: notReachedService("updateTask"),
    getTaskReadModel: notReachedService("getTaskReadModel"),
    pinTask: notReachedService("pinTask"),
    unpinTask: notReachedService("unpinTask"),
    archiveTask: notReachedService("archiveTask"),
    unarchiveTask: notReachedService("unarchiveTask"),
    createTaskReminder: notReachedService("createTaskReminder"),
    cancelTaskReminder: notReachedService("cancelTaskReminder"),

    getTodayPlan: getTodayPlanInApplication,
    planTaskForToday: planTaskForTodayInApplication,
    removeTaskFromToday: notReachedService("removeTaskFromToday"),
    updateTodayTaskStatus: notReachedService("updateTodayTaskStatus"),
    clearCompletedToday: clearCompletedTodayInApplication,

    startTaskSession: startTaskSessionInApplication,
    stopTaskSession: stopTaskSessionInApplication,
  };
}

export class FakeSupabaseProjectsRepository {
  constructor(private readonly client: SupabaseClient<McpDatabase>) {}

  async getProjectBySlug(
    actor: { userId: string },
    slug: string,
  ): Promise<{ ok: true; value: StoreRow | null }> {
    const rows = requireCurrentE2eStore().tables.get("projects") ?? [];
    const row = rows.find(
      (candidate) => candidate.owner_user_id === actor.userId && candidate.slug === slug,
    );
    return { ok: true, value: row ?? null };
  }

  async createProject(
    actor: { userId: string },
    input: { name: string; slug: string; description: string | null },
  ): Promise<{ ok: true; value: null }> {
    const row = requireCurrentE2eStore().seed("projects", {
      owner_user_id: actor.userId,
      name: input.name,
      slug: input.slug,
      description: input.description,
    });
    requireCurrentE2eStore().mutations.push({ table: "projects", op: "insert", rowIds: [row.id] });
    return { ok: true, value: null };
  }

  async updateProjectStatus(
    actor: { userId: string },
    input: { projectId: string; status: string },
  ): Promise<{ ok: true; value: StoreRow | null }> {
    const rows = requireCurrentE2eStore().tables.get("projects") ?? [];
    const row = rows.find(
      (candidate) => candidate.owner_user_id === actor.userId && candidate.id === input.projectId,
    );
    if (!row) return { ok: true, value: null };
    row.status = input.status;
    return { ok: true, value: { ...row } };
  }

  rawClient(): SupabaseClient<McpDatabase> {
    return this.client;
  }
}

export class FakeSupabaseTasksRepository {
  constructor(private readonly client: SupabaseClient<McpDatabase>) {}

  rawClient(): SupabaseClient<McpDatabase> {
    return this.client;
  }

  async getScope(actor: { userId: string }) {
    const store = requireCurrentE2eStore();
    return {
      ok: true as const,
      value: {
        projectIds: (store.tables.get("projects") ?? [])
          .filter((row) => row.owner_user_id === actor.userId)
          .map((row) => row.id as string),
        goals: (store.tables.get("goals") ?? [])
          .filter((row) => row.owner_user_id === actor.userId)
          .map((row) => ({ id: row.id as string, projectId: row.project_id as string })),
      },
    };
  }

  async createTask(actor: { userId: string }, input: StoreRow) {
    const row = requireCurrentE2eStore().seed("tasks", {
      owner_user_id: actor.userId,
      project_id: input.projectId,
      goal_id: input.goalId,
      title: input.title,
      description: input.description,
      blocked_reason: input.blockedReason,
      status: input.status,
      priority: input.priority,
      due_date: input.dueDate,
      estimate_minutes: input.estimateMinutes,
    });
    return { ok: true as const, value: taskRecord(row) };
  }

  async setPlannedDate(actor: { userId: string }, input: { taskId: string; plannedForDate: string | null }) {
    const row = ownedTask(actor.userId, input.taskId);
    if (!row) return { ok: false as const, error: { code: "not_found" as const } };
    row.planned_for_date = input.plannedForDate;
    requireCurrentE2eStore().mutations.push({ table: "tasks", op: "update", patch: { planned_for_date: input.plannedForDate }, rowIds: [row.id] });
    return { ok: true as const, value: taskRecord(row) };
  }

  async clearCompletedPlannedDate(actor: { userId: string }, input: { plannedForDate: string }) {
    const rows = requireCurrentE2eStore().tables.get("tasks") ?? [];
    const cleared = rows.filter((row) => row.owner_user_id === actor.userId && row.status === "completed" && row.planned_for_date === input.plannedForDate);
    for (const row of cleared) row.planned_for_date = null;
    requireCurrentE2eStore().mutations.push({ table: "tasks", op: "update", patch: { planned_for_date: null }, rowIds: cleared.map((row) => row.id) });
    return { ok: true as const, value: cleared.length };
  }
}

export class FakeSupabaseGoalsRepository {
  constructor(private readonly client: SupabaseClient<McpDatabase>) {}

  rawClient(): SupabaseClient<McpDatabase> {
    return this.client;
  }
}

export class FakeSupabaseTodayReadPort {
  constructor(private readonly client: SupabaseClient<McpDatabase>) {}

  rawClient(): SupabaseClient<McpDatabase> {
    return this.client;
  }

  async listSelectedTasks(
    actor: { userId: string },
    date: string,
  ): Promise<{ ok: true; value: StoreRow[] }> {
    const rows = requireCurrentE2eStore().tables.get("tasks") ?? [];
    return {
      ok: true,
      value: rows.filter(
        (row) => row.owner_user_id === actor.userId && row.planned_for_date === date,
      ),
    };
  }
}

export class FakeSupabaseTimeContextRepository {
  constructor(private readonly client: SupabaseClient<McpDatabase>) {}

  async getTimezone(_actor: { userId: string }): Promise<{ ok: true; value: null }> {
    void _actor;
    return { ok: true, value: null };
  }

  async setTimezone(
    _actor: { userId: string },
    timezone: string,
  ): Promise<{ ok: true; value: string }> {
    return { ok: true, value: timezone };
  }
}

export class FakeSupabaseTimerSessionRepository {
  constructor(private readonly client: SupabaseClient<McpDatabase>) {}

  rawClient(): SupabaseClient<McpDatabase> {
    return this.client;
  }

  async listOpenSessions(actor: { userId: string }): Promise<{ ok: true; value: StoreRow[] }> {
    const rows = requireCurrentE2eStore().tables.get("task_sessions") ?? [];
    return {
      ok: true,
      value: rows.filter((row) => row.owner_user_id === actor.userId && row.ended_at == null).map(timerRecord),
    };
  }

  async listRecentSessions(
    actor: { userId: string },
    input: { limit?: number },
  ): Promise<{ ok: true; value: StoreRow[] }> {
    const rows = requireCurrentE2eStore().tables.get("task_sessions") ?? [];
    const closed = rows.filter((row) => row.owner_user_id === actor.userId && row.ended_at != null);
    return { ok: true, value: closed.slice(0, input?.limit ?? 25).map(timerRecord) };
  }

  async getStartableTask(actor: { userId: string }, input: { taskId: string }) {
    const task = ownedTask(actor.userId, input.taskId);
    return { ok: true as const, value: task ? { eligible: true, reason: null, taskTitle: task.title as string } : null };
  }

  async findSessionByOperation(
    actor: { userId: string },
    input: { mcpOperationId: string; mcpClientId: string },
  ) {
    const row = (requireCurrentE2eStore().tables.get("task_sessions") ?? []).find(
      (candidate) => candidate.owner_user_id === actor.userId
        && candidate.mcp_client_id === input.mcpClientId
        && candidate.mcp_operation_id === input.mcpOperationId,
    );
    return { ok: true as const, value: row ? timerRecord(row) : null };
  }

  async insertOpenSession(
    actor: { userId: string },
    input: {
      taskId: string;
      startedAtIso: string;
      mcpOperationId?: string;
      mcpClientId?: string;
    },
  ) {
    const store = requireCurrentE2eStore();
    const rows = store.tables.get("task_sessions") ?? [];
    const existing = input.mcpOperationId && input.mcpClientId
      ? rows.find(
          (candidate) => candidate.owner_user_id === actor.userId
            && candidate.mcp_client_id === input.mcpClientId
            && candidate.mcp_operation_id === input.mcpOperationId,
        )
      : undefined;
    if (existing) return { ok: true as const, value: timerRecord(existing) };

    if (rows.some((candidate) => candidate.owner_user_id === actor.userId && candidate.ended_at == null)) {
      return { ok: false as const, error: { code: "conflict" as const } };
    }

    const row = store.seed("task_sessions", {
      owner_user_id: actor.userId,
      task_id: input.taskId,
      started_at: input.startedAtIso,
      mcp_operation_id: input.mcpOperationId,
      mcp_client_id: input.mcpClientId,
    });
    store.mutations.push({ table: "task_sessions", op: "insert", rowIds: [row.id] });
    return { ok: true as const, value: timerRecord(row) };
  }

  async finalizeOpenSession(actor: { userId: string }, input: { sessionId: string; endedAtIso: string; durationSeconds: number }) {
    const row = (requireCurrentE2eStore().tables.get("task_sessions") ?? []).find(
      (candidate) => candidate.owner_user_id === actor.userId && candidate.id === input.sessionId && candidate.ended_at == null,
    );
    if (!row) return { ok: true as const, value: false };
    row.ended_at = input.endedAtIso;
    row.duration_seconds = input.durationSeconds;
    return { ok: true as const, value: true };
  }
}
