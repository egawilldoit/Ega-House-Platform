import type { CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TIMER_ALREADY_RUNNING_MESSAGE,
  TIMER_NO_OPEN_SESSION_MATCH_MESSAGE,
  TIMER_SESSION_NO_LONGER_RUNNING_MESSAGE,
  TIMER_TASK_UNAVAILABLE_MESSAGE,
} from "@ega/application";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpPrincipal } from "@/lib/mcp/principal";
import {
  createMcpTimerModuleHandlers,
  type McpWriteModuleDeps,
} from "@/lib/mcp/write/timer";

const mocks = vi.hoisted(() => ({
  startTaskSession: vi.fn(),
  stopTaskSession: vi.fn(),
  repositoryFactory: vi.fn(),
}));

vi.mock("@ega/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ega/application")>();
  return {
    ...actual,
    startTaskSession: mocks.startTaskSession,
    stopTaskSession: mocks.stopTaskSession,
  };
});

vi.mock("@ega/data-access", () => ({
  SupabaseTimerSessionRepository: mocks.repositoryFactory,
}));

const PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-0000-0000-000000000001",
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "workspace_manager",
  permissionsVersion: 1,
  permissions: ["timer.read", "timer.create", "timer.update"],
};

const READ_ONLY_PRINCIPAL: McpPrincipal = {
  ...PRINCIPAL,
  permissionProfile: "read_only",
  permissions: ["timer.read"],
};

const OPEN_SESSION = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  taskId: "bbbbbbbb-0000-0000-0000-000000000001",
  startedAt: "2026-08-28T10:00:00.000Z",
  endedAt: null,
  durationSeconds: null,
  taskTitle: "Open work",
};

const CLOSED_SESSION = {
  id: "aaaaaaaa-0000-0000-0000-000000000002",
  taskId: "bbbbbbbb-0000-0000-0000-000000000001",
  startedAt: "2026-08-28T09:00:00.000Z",
  endedAt: "2026-08-28T09:45:00.000Z",
  durationSeconds: 2700,
  taskTitle: "Closed work",
};

function createDependencies(): McpWriteModuleDeps {
  return {
    createUserClient: vi.fn().mockReturnValue({} as SupabaseClient<McpDatabase>),
  };
}

function withRepositoryMock(overrides: Partial<Record<string, unknown>> = {}) {
  const repository = {
    listOpenSessions: vi.fn(),
    listRecentSessions: vi.fn(),
    getStartableTask: vi.fn(),
    insertOpenSession: vi.fn(),
    finalizeOpenSession: vi.fn(),
    ...overrides,
  };
  // Constructed with `new` by the module under test, so the mock
  // implementation must be a constructible function, not an arrow.
  mocks.repositoryFactory.mockReset();
  mocks.repositoryFactory.mockImplementation(function () {
    return repository;
  });
  return repository;
}

function structured(result: CallToolResult): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

describe("MCP timer write module handlers", () => {
  let dependencies: McpWriteModuleDeps;

  beforeEach(() => {
    dependencies = createDependencies();
    mocks.startTaskSession.mockReset();
    mocks.stopTaskSession.mockReset();
    withRepositoryMock();
  });

  describe("startTimer", () => {
    it("delegates to the canonical start service with the authenticated actor and taskId", async () => {
      const handlers = createMcpTimerModuleHandlers(dependencies, true);
      mocks.startTaskSession.mockResolvedValue({
        ok: true,
        data: {
          sessionId: OPEN_SESSION.id,
          taskId: OPEN_SESSION.taskId,
          startedAt: OPEN_SESSION.startedAt,
          elapsedLabel: "0m",
          taskTitle: "Open work",
        },
      });

      const result = await handlers.startTimer(
        createMcpAuthInfo("test-bearer", PRINCIPAL),
        { taskId: OPEN_SESSION.taskId },
      );

      expect(mocks.startTaskSession).toHaveBeenCalledTimes(1);
      const [actor, repository, input] = mocks.startTaskSession.mock.calls[0];
      expect(actor).toEqual({ userId: PRINCIPAL.ownerUserId });
      expect(repository).toBeDefined();
      expect(input).toEqual({ taskId: OPEN_SESSION.taskId });
      expect(dependencies.createUserClient).toHaveBeenCalledWith("test-bearer");

      expect(result.isError).toBeUndefined();
      expect(structured(result)).toEqual({
        ok: true,
        session: {
          id: OPEN_SESSION.id,
          taskId: OPEN_SESSION.taskId,
          startedAt: OPEN_SESSION.startedAt,
          elapsedLabel: "0m",
          taskTitle: "Open work",
        },
      });
    });

    it("maps a foreign or unknown task to the canonical rejection", async () => {
      const handlers = createMcpTimerModuleHandlers(dependencies, true);
      mocks.startTaskSession.mockResolvedValue({
        ok: false,
        errorMessage: TIMER_TASK_UNAVAILABLE_MESSAGE,
      });

      const result = await handlers.startTimer(
        createMcpAuthInfo("test-bearer", PRINCIPAL),
        { taskId: "bbbbbbbb-0000-0000-0000-000000000099" },
      );

      expect(result.isError).toBe(true);
      expect(structured(result)).toEqual({
        ok: false,
        error: { code: "NOT_FOUND", message: TIMER_TASK_UNAVAILABLE_MESSAGE },
      });
    });

    it("maps the canonical already-running conflict to a CONFLICT payload", async () => {
      const handlers = createMcpTimerModuleHandlers(dependencies, true);
      mocks.startTaskSession.mockResolvedValue({
        ok: false,
        errorMessage: TIMER_ALREADY_RUNNING_MESSAGE,
      });

      const result = await handlers.startTimer(
        createMcpAuthInfo("test-bearer", PRINCIPAL),
        { taskId: OPEN_SESSION.taskId },
      );

      expect(result.isError).toBe(true);
      expect(structured(result)).toEqual({
        ok: false,
        error: { code: "CONFLICT", message: TIMER_ALREADY_RUNNING_MESSAGE },
      });
    });
  });

  describe("stopTimer", () => {
    it("delegates to the canonical stop service and never touches persistence directly", async () => {
      const repository = withRepositoryMock();
      const handlers = createMcpTimerModuleHandlers(dependencies, true);
      mocks.stopTaskSession.mockResolvedValue({
        ok: true,
        data: { sessionId: OPEN_SESSION.id, taskId: OPEN_SESSION.taskId },
      });

      const result = await handlers.stopTimer(
        createMcpAuthInfo("test-bearer", PRINCIPAL),
        { sessionId: OPEN_SESSION.id },
      );

      expect(mocks.stopTaskSession).toHaveBeenCalledTimes(1);
      const [actor, , input] = mocks.stopTaskSession.mock.calls[0];
      expect(actor).toEqual({ userId: PRINCIPAL.ownerUserId });
      expect(input).toEqual({ sessionId: OPEN_SESSION.id });
      expect(repository.finalizeOpenSession).not.toHaveBeenCalled();

      expect(result.isError).toBeUndefined();
      expect(structured(result)).toEqual({
        ok: true,
        session: { id: OPEN_SESSION.id, taskId: OPEN_SESSION.taskId },
      });
    });

    it("maps a foreign or non-matching session to the canonical failure", async () => {
      const handlers = createMcpTimerModuleHandlers(dependencies, true);
      mocks.stopTaskSession.mockResolvedValue({
        ok: false,
        errorMessage: TIMER_NO_OPEN_SESSION_MATCH_MESSAGE,
      });

      const result = await handlers.stopTimer(
        createMcpAuthInfo("test-bearer", PRINCIPAL),
        { sessionId: "aaaaaaaa-0000-0000-0000-000000000099" },
      );

      expect(result.isError).toBe(true);
      expect(structured(result)).toEqual({
        ok: false,
        error: { code: "NOT_FOUND", message: TIMER_NO_OPEN_SESSION_MATCH_MESSAGE },
      });
    });

    it("maps an already-closed session to a canonical CONFLICT failure", async () => {
      const handlers = createMcpTimerModuleHandlers(dependencies, true);
      mocks.stopTaskSession.mockResolvedValue({
        ok: false,
        errorMessage: TIMER_SESSION_NO_LONGER_RUNNING_MESSAGE,
      });

      const result = await handlers.stopTimer(
        createMcpAuthInfo("test-bearer", PRINCIPAL),
        { sessionId: OPEN_SESSION.id },
      );

      expect(result.isError).toBe(true);
      expect(structured(result)).toEqual({
        ok: false,
        error: { code: "CONFLICT", message: TIMER_SESSION_NO_LONGER_RUNNING_MESSAGE },
      });
    });
  });

  describe("listTimerSessions", () => {
    it("reads open and recent sessions owner-scoped through the canonical repository", async () => {
      const repository = withRepositoryMock();
      repository.listOpenSessions.mockResolvedValue({ ok: true, value: [OPEN_SESSION] });
      repository.listRecentSessions.mockResolvedValue({
        ok: true,
        value: [OPEN_SESSION, CLOSED_SESSION],
      });
      const handlers = createMcpTimerModuleHandlers(dependencies, false);

      const result = await handlers.listTimerSessions(
        createMcpAuthInfo("test-bearer", PRINCIPAL),
        { limit: 10, includeClosed: true },
      );

      const [actor] = repository.listOpenSessions.mock.calls[0];
      expect(actor).toEqual({ userId: PRINCIPAL.ownerUserId });
      expect(repository.listRecentSessions).toHaveBeenCalledWith(
        { userId: PRINCIPAL.ownerUserId },
        { limit: 10 },
      );
      expect(structured(result)).toEqual({
        ok: true,
        sessions: [OPEN_SESSION, CLOSED_SESSION],
        count: 2,
        limit: 10,
      });
    });

    it("skips recent sessions unless includeClosed is requested", async () => {
      const repository = withRepositoryMock();
      repository.listOpenSessions.mockResolvedValue({ ok: true, value: [OPEN_SESSION] });
      const handlers = createMcpTimerModuleHandlers(dependencies, false);

      const result = await handlers.listTimerSessions(
        createMcpAuthInfo("test-bearer", PRINCIPAL),
        { includeClosed: false },
      );

      expect(repository.listRecentSessions).not.toHaveBeenCalled();
      expect(structured(result)).toEqual({
        ok: true,
        sessions: [OPEN_SESSION],
        count: 1,
        limit: 25,
      });
    });
  });

  describe("authorization", () => {
    it("maps an unauthenticated call to the UNAUTHENTICATED payload without creating a client", async () => {
      const handlers = createMcpTimerModuleHandlers(dependencies, true);

      const startResult = await handlers.startTimer(undefined, { taskId: OPEN_SESSION.taskId });
      const stopResult = await handlers.stopTimer(undefined, { sessionId: OPEN_SESSION.id });
      const listResult = await handlers.listTimerSessions(undefined, {});

      expect(structured(startResult)).toEqual({
        ok: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required for this tool.",
        },
      });
      expect(structured(stopResult).error).toMatchObject({ code: "UNAUTHENTICATED" });
      expect(structured(listResult).error).toMatchObject({ code: "UNAUTHENTICATED" });
      expect(startResult.isError).toBe(true);
      expect(stopResult.isError).toBe(true);
      expect(listResult.isError).toBe(true);
      expect(dependencies.createUserClient).not.toHaveBeenCalled();
    });

    it("maps a missing timer.create permission to PERMISSION_DENIED", async () => {
      const handlers = createMcpTimerModuleHandlers(dependencies, true);

      const result = await handlers.startTimer(
        createMcpAuthInfo("test-bearer", READ_ONLY_PRINCIPAL),
        { taskId: OPEN_SESSION.taskId },
      );

      expect(result.isError).toBe(true);
      expect(structured(result)).toEqual({
        ok: false,
        error: {
          code: "PERMISSION_DENIED",
          message: "The active EGA grant does not allow timer.create.",
        },
      });
      expect(dependencies.createUserClient).not.toHaveBeenCalled();
    });

    it("blocks writes when writes are disabled but keeps timer reads available", async () => {
      const repository = withRepositoryMock();
      repository.listOpenSessions.mockResolvedValue({ ok: true, value: [OPEN_SESSION] });
      const handlers = createMcpTimerModuleHandlers(dependencies, false);

      const startResult = await handlers.startTimer(
        createMcpAuthInfo("test-bearer", PRINCIPAL),
        { taskId: OPEN_SESSION.taskId },
      );
      const listResult = await handlers.listTimerSessions(
        createMcpAuthInfo("test-bearer", PRINCIPAL),
        {},
      );

      expect(structured(startResult)).toMatchObject({
        ok: false,
        error: { code: "WRITES_DISABLED" },
      });
      expect(structured(listResult)).toMatchObject({ ok: true });
      expect(mocks.startTaskSession).not.toHaveBeenCalled();
    });
  });
});
