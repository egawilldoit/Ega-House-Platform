import type { CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearCompletedToday,
  getTodayPlan,
  planTaskForToday,
  removeTaskFromToday,
  updateTodayTaskStatus,
} from "@ega/application";
import {
  SupabaseTasksRepository,
  SupabaseTimeContextRepository,
  SupabaseTodayReadPort,
} from "@ega/data-access";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpPrincipal } from "@/lib/mcp/principal";

import { createMcpTodayWriteHandlers } from "./today";

vi.mock("@ega/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ega/application")>();
  return {
    ...actual,
    clearCompletedToday: vi.fn(),
    getTodayPlan: vi.fn(),
    planTaskForToday: vi.fn(),
    removeTaskFromToday: vi.fn(),
    updateTodayTaskStatus: vi.fn(),
  };
});

vi.mock("@ega/data-access", () => ({
  SupabaseTasksRepository: vi.fn(),
  SupabaseTimeContextRepository: vi.fn(),
  SupabaseTodayReadPort: vi.fn(),
}));

const OWNER_A = "00000000-0000-0000-0000-000000000001";
const OWNER_B = "00000000-0000-0000-0000-000000000002";

function principalFor(
  ownerUserId: string,
  permissions: McpPrincipal["permissions"] = [
    "projects.read",
    "goals.read",
    "tasks.read",
    "tasks.create",
    "tasks.update",
    "today.read",
    "today.update",
    "timer.read",
    "timer.create",
    "timer.update",
  ],
): McpPrincipal {
  return {
    ownerUserId,
    oauthClientId: "hermes-client",
    grantId: "10000000-0000-0000-0000-000000000001",
    permissionProfile: "workspace_manager",
    permissionsVersion: 1,
    permissions,
  };
}

const PRINCIPAL = principalFor(OWNER_A);
const AUTH_INFO = createMcpAuthInfo("token-a", PRINCIPAL);

const CLIENT = { marker: "user-client" } as unknown as SupabaseClient<McpDatabase>;
const PORT_INSTANCE = { marker: "today-port" };
const TIME_CONTEXT_INSTANCE = { marker: "time-context" };
const REPOSITORY_INSTANCE = { marker: "today-repository" };

const PLAN = {
  date: "2026-08-28",
  sections: { planned: [], inProgress: [], blocked: [], completed: [] },
  suggestions: { pinned: [], inProgress: [] },
  summary: {
    plannedCount: 0,
    inProgressCount: 0,
    blockedCount: 0,
    completedCount: 0,
    selectedCount: 0,
    clearableCompletedCount: 0,
    overdueCount: 0,
    dueTodayCount: 0,
    totalEstimateMinutes: 0,
    trackedTodaySeconds: 0,
    trackedTodayLabel: "0m",
  },
  activeTimer: null,
};

const TASK = {
  id: "task-1",
  title: "Ship Today module",
  description: null,
  blockedReason: null,
  status: "todo",
  priority: "medium",
  dueDate: null,
  estimateMinutes: 30,
  projectId: "project-1",
  goalId: null,
  plannedForDate: "2026-08-28",
  focusRank: null,
  archivedAt: null,
  updatedAt: "2026-08-28T00:00:00.000Z",
  reminders: [],
  recurrence: null,
};

type DepsOverrides = Partial<Parameters<typeof createMcpTodayWriteHandlers>[0]>;

function createDeps(overrides: DepsOverrides = {}) {
  return {
    createUserClient: vi.fn().mockReturnValue(CLIENT),
    clearCompletedMrtr: {
      firstRound: vi.fn(),
      verifySecondRound: vi.fn(),
    },
    readVerifiedClearCompletedState: vi.fn().mockReturnValue(undefined),
    ...overrides,
  };
}

function okData(data: unknown) {
  return { ok: true as const, data };
}

function failure(errorMessage: string) {
  return { ok: false as const, errorMessage };
}

describe("createMcpTodayWriteHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SupabaseTodayReadPort).mockImplementation(function () {
      return PORT_INSTANCE as never;
    });
    vi.mocked(SupabaseTimeContextRepository).mockImplementation(function () {
      return TIME_CONTEXT_INSTANCE as never;
    });
    vi.mocked(SupabaseTasksRepository).mockImplementation(function () {
      return REPOSITORY_INSTANCE as never;
    });
  });

  describe("getTodayPlan", () => {
    it("builds the owner-scoped plan through the canonical read port and actor derived from the principal", async () => {
      vi.mocked(getTodayPlan).mockResolvedValue(okData(PLAN) as never);
      const deps = createDeps();
      const handlers = createMcpTodayWriteHandlers(deps);

      const result = await handlers.getTodayPlan(AUTH_INFO, { date: "2026-08-28" });

      expect(deps.createUserClient).toHaveBeenCalledWith("token-a");
      expect(SupabaseTodayReadPort).toHaveBeenCalledWith(CLIENT);
      expect(getTodayPlan).toHaveBeenCalledWith(
        { userId: OWNER_A },
        PORT_INSTANCE,
        TIME_CONTEXT_INSTANCE,
        { date: "2026-08-28" },
      );
      expect(result.structuredContent).toEqual({
        ok: true,
        today: "2026-08-28",
        sections: PLAN.sections,
        suggestions: PLAN.suggestions,
        summary: PLAN.summary,
        activeTimer: null,
      });
      expect(result.isError).toBeUndefined();
    });

    it("derives the actor from each principal, so cross-owner reads are impossible", async () => {
      vi.mocked(getTodayPlan).mockResolvedValue(okData(PLAN) as never);
      const deps = createDeps();
      const handlers = createMcpTodayWriteHandlers(deps);

      await handlers.getTodayPlan(AUTH_INFO, { date: "2026-08-28" });

      const principalB = principalFor(OWNER_B);
      const authInfoB = createMcpAuthInfo("token-b", principalB);
      await handlers.getTodayPlan(authInfoB, { date: "2026-08-28" });

      expect(deps.createUserClient).toHaveBeenNthCalledWith(1, "token-a");
      expect(deps.createUserClient).toHaveBeenNthCalledWith(2, "token-b");
      expect(getTodayPlan).toHaveBeenNthCalledWith(
        1,
        { userId: OWNER_A },
        PORT_INSTANCE,
        TIME_CONTEXT_INSTANCE,
        { date: "2026-08-28" },
      );
      expect(getTodayPlan).toHaveBeenNthCalledWith(
        2,
        { userId: OWNER_B },
        PORT_INSTANCE,
        TIME_CONTEXT_INSTANCE,
        { date: "2026-08-28" },
      );
    });

    it("exposes only the bounded plan DTO (no internal fields)", async () => {
      vi.mocked(getTodayPlan).mockResolvedValue(okData(PLAN) as never);
      const handlers = createMcpTodayWriteHandlers(createDeps());

      const result = await handlers.getTodayPlan(AUTH_INFO, {});

      expect(Object.keys(result.structuredContent ?? {}).sort()).toEqual(
        ["activeTimer", "ok", "sections", "summary", "suggestions", "today"].sort(),
      );
      expect(getTodayPlan).toHaveBeenCalledWith(
        { userId: OWNER_A },
        PORT_INSTANCE,
        TIME_CONTEXT_INSTANCE,
        { date: undefined },
      );
    });

    it("maps canonical failure to a stable error result", async () => {
      vi.mocked(getTodayPlan).mockResolvedValue(failure("Today date is invalid.") as never);
      const handlers = createMcpTodayWriteHandlers(createDeps());

      const result = await handlers.getTodayPlan(AUTH_INFO, { date: "bad-date" });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        ok: false,
        error: { code: "APPLICATION_ERROR", message: "Today date is invalid." },
      });
    });

    it("denies callers without today.read before building the plan", async () => {
      const handlers = createMcpTodayWriteHandlers(createDeps());
      const denied = createMcpAuthInfo("token-a", principalFor(OWNER_A, []));

      const result = await handlers.getTodayPlan(denied, { date: "2026-08-28" });

      expect(result.isError).toBe(true);
      expect((result.structuredContent as { error: { code: string } }).error.code).toBe(
        "PERMISSION_DENIED",
      );
      expect(SupabaseTodayReadPort).not.toHaveBeenCalled();
      expect(getTodayPlan).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated calls", async () => {
      const handlers = createMcpTodayWriteHandlers(createDeps());

      const result = await handlers.getTodayPlan(undefined, { date: "2026-08-28" });

      expect(result.isError).toBe(true);
      expect((result.structuredContent as { error: { code: string } }).error.code).toBe(
        "UNAUTHENTICATED",
      );
      expect(getTodayPlan).not.toHaveBeenCalled();
    });
  });

  describe("planTaskForToday", () => {
    it("delegates to the canonical service with the actor and the canonical task repository", async () => {
      vi.mocked(planTaskForToday).mockResolvedValue(okData(TASK) as never);
      const deps = createDeps();
      const handlers = createMcpTodayWriteHandlers(deps);

      const result = await handlers.planTaskForToday(AUTH_INFO, {
        taskId: "task-1",
        date: "2026-08-28",
      });

      expect(deps.createUserClient).toHaveBeenCalledWith("token-a");
      expect(SupabaseTasksRepository).toHaveBeenCalledWith(CLIENT);
      expect(planTaskForToday).toHaveBeenCalledWith(
        { userId: OWNER_A },
        REPOSITORY_INSTANCE,
        { taskId: "task-1", date: "2026-08-28" },
      );
      expect(result.structuredContent).toEqual({
        ok: true,
        task: {
          id: "task-1",
          title: "Ship Today module",
          status: "todo",
          priority: "medium",
          projectId: "project-1",
          goalId: null,
          plannedForDate: "2026-08-28",
          dueDate: null,
          blockedReason: null,
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
      });
    });

    it("maps canonical failure without mutating", async () => {
      vi.mocked(planTaskForToday).mockResolvedValue(
        failure("Unable to add task to Today right now.") as never,
      );
      const handlers = createMcpTodayWriteHandlers(createDeps());

      const result = await handlers.planTaskForToday(AUTH_INFO, {
        taskId: "task-1",
        date: "bad",
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        ok: false,
        error: {
          code: "APPLICATION_ERROR",
          message: "Unable to add task to Today right now.",
        },
      });
    });

    it("requires today.update", async () => {
      const handlers = createMcpTodayWriteHandlers(createDeps());
      const denied = createMcpAuthInfo(
        "token-a",
        principalFor(OWNER_A, ["today.read", "tasks.read"]),
      );

      const result = await handlers.planTaskForToday(denied, {
        taskId: "task-1",
        date: "2026-08-28",
      });

      expect((result.structuredContent as { error: { code: string } }).error.code).toBe(
        "PERMISSION_DENIED",
      );
      expect(planTaskForToday).not.toHaveBeenCalled();
      expect(SupabaseTasksRepository).not.toHaveBeenCalled();
    });
  });

  describe("removeTaskFromToday", () => {
    it("calls canonical removeTaskFromToday and never a task delete", async () => {
      const removedTask = { ...TASK, plannedForDate: null, status: "todo" };
      vi.mocked(removeTaskFromToday).mockResolvedValue(okData(removedTask) as never);
      const deps = createDeps();
      const handlers = createMcpTodayWriteHandlers(deps);

      const result = await handlers.removeTaskFromToday(AUTH_INFO, { taskId: "task-1" });

      expect(removeTaskFromToday).toHaveBeenCalledTimes(1);
      expect(removeTaskFromToday).toHaveBeenCalledWith(
        { userId: OWNER_A },
        REPOSITORY_INSTANCE,
        { taskId: "task-1" },
      );
      expect(planTaskForToday).not.toHaveBeenCalled();
      expect(updateTodayTaskStatus).not.toHaveBeenCalled();
      expect(clearCompletedToday).not.toHaveBeenCalled();
      expect((result.structuredContent as { task: { plannedForDate: string | null } }).task)
        .toEqual(
          expect.objectContaining({ id: "task-1", plannedForDate: null }),
        );
    });

    it("maps canonical failure", async () => {
      vi.mocked(removeTaskFromToday).mockResolvedValue(
        failure("Unable to remove task from Today right now.") as never,
      );
      const handlers = createMcpTodayWriteHandlers(createDeps());

      const result = await handlers.removeTaskFromToday(AUTH_INFO, { taskId: "task-1" });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        ok: false,
        error: {
          code: "APPLICATION_ERROR",
          message: "Unable to remove task from Today right now.",
        },
      });
    });

    it("requires today.update", async () => {
      const handlers = createMcpTodayWriteHandlers(createDeps());
      const denied = createMcpAuthInfo("token-a", principalFor(OWNER_A, ["today.read"]));

      const result = await handlers.removeTaskFromToday(denied, { taskId: "task-1" });

      expect((result.structuredContent as { error: { code: string } }).error.code).toBe(
        "PERMISSION_DENIED",
      );
      expect(removeTaskFromToday).not.toHaveBeenCalled();
    });
  });

  describe("updateTodayTaskStatus", () => {
    it("delegates status and blockedReason rules to the canonical service", async () => {
      const blockedTask = { ...TASK, status: "blocked", blockedReason: "waiting on review" };
      vi.mocked(updateTodayTaskStatus).mockResolvedValue(okData(blockedTask) as never);
      const handlers = createMcpTodayWriteHandlers(createDeps());

      const result = await handlers.updateTodayTaskStatus(AUTH_INFO, {
        taskId: "task-1",
        status: "blocked",
        blockedReason: "waiting on review",
      });

      expect(updateTodayTaskStatus).toHaveBeenCalledWith(
        { userId: OWNER_A },
        REPOSITORY_INSTANCE,
        { taskId: "task-1", status: "blocked", blockedReason: "waiting on review" },
      );
      expect((result.structuredContent as { task: { status: string } }).task.status).toBe(
        "blocked",
      );
    });

    it("keeps canonical validation authoritative (blocked requires a reason)", async () => {
      vi.mocked(updateTodayTaskStatus).mockResolvedValue(
        failure("Blocked reason is required when status is Blocked.") as never,
      );
      const handlers = createMcpTodayWriteHandlers(createDeps());

      const result = await handlers.updateTodayTaskStatus(AUTH_INFO, {
        taskId: "task-1",
        status: "blocked",
      });

      expect(updateTodayTaskStatus).toHaveBeenCalledWith(
        { userId: OWNER_A },
        REPOSITORY_INSTANCE,
        { taskId: "task-1", status: "blocked", blockedReason: undefined },
      );
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { error: { message: string } }).error.message).toBe(
        "Blocked reason is required when status is Blocked.",
      );
    });

    it("requires today.update", async () => {
      const handlers = createMcpTodayWriteHandlers(createDeps());
      const denied = createMcpAuthInfo("token-a", principalFor(OWNER_A, ["today.read"]));

      const result = await handlers.updateTodayTaskStatus(denied, {
        taskId: "task-1",
        status: "done",
      });

      expect((result.structuredContent as { error: { code: string } }).error.code).toBe(
        "PERMISSION_DENIED",
      );
      expect(updateTodayTaskStatus).not.toHaveBeenCalled();
    });
  });

  describe("clearCompletedToday", () => {
    function mrtrResult(): CallToolResult {
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, awaiting: "confirm" }) }],
        structuredContent: { ok: true, awaiting: "confirm" },
      };
    }

    it("first round delegates to the injected mrtr helper and performs no mutation", async () => {
      const firstRound = vi.fn().mockResolvedValue(mrtrResult());
      const deps = createDeps({
        clearCompletedMrtr: { firstRound, verifySecondRound: vi.fn() },
        readVerifiedClearCompletedState: vi.fn().mockReturnValue(undefined),
      });
      const handlers = createMcpTodayWriteHandlers(deps);

      const result = await handlers.clearCompletedToday(
        AUTH_INFO,
        { date: "2026-08-28", operationId: "op-1" },
        { mcpReq: {} },
      );

      expect(deps.readVerifiedClearCompletedState).toHaveBeenCalledWith({ mcpReq: {} });
      expect(firstRound).toHaveBeenCalledWith(
        { date: "2026-08-28", operationId: "op-1" },
        PRINCIPAL,
      );
      expect(result).toEqual(mrtrResult());
      expect(SupabaseTasksRepository).not.toHaveBeenCalled();
      expect(clearCompletedToday).not.toHaveBeenCalled();
    });

    it("second round verifies state, re-checks permission, then calls the canonical clear", async () => {
      vi.mocked(clearCompletedToday).mockResolvedValue(okData({ clearedCount: 3 }) as never);
      const verifySecondRound = vi.fn().mockResolvedValue(undefined);
      const deps = createDeps({
        clearCompletedMrtr: { firstRound: vi.fn(), verifySecondRound },
        readVerifiedClearCompletedState: vi
          .fn()
          .mockReturnValue({ phase: "awaiting_confirmation" }),
      });
      const handlers = createMcpTodayWriteHandlers(deps);
      const ctx = { mcpReq: { requestState: () => ({ phase: "awaiting_confirmation" }) } };

      const result = await handlers.clearCompletedToday(
        AUTH_INFO,
        { date: "2026-08-28", operationId: "op-1" },
        ctx,
      );

      expect(verifySecondRound).toHaveBeenCalledWith(
        ctx,
        { date: "2026-08-28", operationId: "op-1" },
        PRINCIPAL,
      );
      expect(SupabaseTasksRepository).toHaveBeenCalledWith(CLIENT);
      expect(clearCompletedToday).toHaveBeenCalledWith(
        { userId: OWNER_A },
        REPOSITORY_INSTANCE,
        { date: "2026-08-28" },
      );
      expect(result.structuredContent).toEqual({ ok: true, clearedCount: 3 });
    });

    it("maps canonical failure on the second round", async () => {
      vi.mocked(clearCompletedToday).mockResolvedValue(
        failure("Unable to clear completed Today items right now.") as never,
      );
      const deps = createDeps({
        clearCompletedMrtr: { firstRound: vi.fn(), verifySecondRound: vi.fn().mockResolvedValue(undefined) },
        readVerifiedClearCompletedState: vi.fn().mockReturnValue({ phase: "awaiting_confirmation" }),
      });
      const handlers = createMcpTodayWriteHandlers(deps);

      const result = await handlers.clearCompletedToday(AUTH_INFO, {
        date: "2026-08-28",
        operationId: "op-1",
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        ok: false,
        error: {
          code: "APPLICATION_ERROR",
          message: "Unable to clear completed Today items right now.",
        },
      });
    });

    it("performs no mutation when the second round fails verification", async () => {
      const verifySecondRound = vi.fn().mockRejectedValue(new Error("STATE_MISMATCH"));
      const deps = createDeps({
        clearCompletedMrtr: { firstRound: vi.fn(), verifySecondRound },
        readVerifiedClearCompletedState: vi.fn().mockReturnValue({ phase: "stale" }),
      });
      const handlers = createMcpTodayWriteHandlers(deps);

      const result = await handlers.clearCompletedToday(AUTH_INFO, {
        date: "2026-08-28",
        operationId: "op-1",
      });

      expect(verifySecondRound).toHaveBeenCalledTimes(1);
      expect(result.isError).toBe(true);
      expect(clearCompletedToday).not.toHaveBeenCalled();
      expect(SupabaseTasksRepository).not.toHaveBeenCalled();
    });

    it("still requires today.update when verified state is present", async () => {
      const verifySecondRound = vi.fn();
      const deps = createDeps({
        clearCompletedMrtr: { firstRound: vi.fn(), verifySecondRound },
        readVerifiedClearCompletedState: vi.fn().mockReturnValue({ phase: "awaiting_confirmation" }),
      });
      const handlers = createMcpTodayWriteHandlers(deps);
      const denied = createMcpAuthInfo("token-a", principalFor(OWNER_A, ["today.read"]));

      const result = await handlers.clearCompletedToday(denied, {
        date: "2026-08-28",
        operationId: "op-1",
      });

      expect((result.structuredContent as { error: { code: string } }).error.code).toBe(
        "PERMISSION_DENIED",
      );
      expect(verifySecondRound).not.toHaveBeenCalled();
      expect(clearCompletedToday).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated calls before any round", async () => {
      const handlers = createMcpTodayWriteHandlers(createDeps());

      const result = await handlers.clearCompletedToday(undefined, {
        date: "2026-08-28",
        operationId: "op-1",
      });

      expect((result.structuredContent as { error: { code: string } }).error.code).toBe(
        "UNAUTHENTICATED",
      );
      expect(clearCompletedToday).not.toHaveBeenCalled();
    });
  });
});
