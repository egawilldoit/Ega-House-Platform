import type { AuthInfo } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applicationFailure,
  applicationSuccess,
  toMobileTaskListItem,
  type TaskRecord,
} from "@ega/application";
import { SupabaseTasksRepository } from "@ega/data-access";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { createTaskMcpWriteHandlers } from "@/lib/mcp/write/tasks";

vi.mock("@ega/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ega/application")>();
  return {
    ...actual,
    getTaskReadModel: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    archiveTask: vi.fn(),
    unarchiveTask: vi.fn(),
    pinTask: vi.fn(),
    unpinTask: vi.fn(),
    createTaskReminder: vi.fn(),
    cancelTaskReminder: vi.fn(),
  };
});

import * as application from "@ega/application";

const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
const ACCESS_TOKEN = "test-bearer-token";

const PRINCIPAL: McpPrincipal = {
  ownerUserId: OWNER_USER_ID,
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "task_manager",
  permissionsVersion: 1,
  permissions: [
    "projects.read",
    "goals.read",
    "tasks.read",
    "tasks.create",
    "tasks.update",
    "today.read",
    "timer.read",
  ],
};

const READ_ONLY_PRINCIPAL: McpPrincipal = {
  ...PRINCIPAL,
  permissionProfile: "read_only",
  permissions: ["projects.read", "goals.read", "tasks.read"],
};

const TASK_RECORD: TaskRecord = {
  id: "task-1",
  title: "Repair the greenhouse door",
  description: null,
  blockedReason: null,
  status: "todo",
  priority: "high",
  dueDate: "2026-09-02",
  estimateMinutes: 45,
  projectId: "project-1",
  goalId: null,
  plannedForDate: null,
  focusRank: null,
  archivedAt: null,
  updatedAt: "2026-08-28T00:00:00.000Z",
  reminders: [],
  recurrence: null,
};

type TaskServiceMock = ReturnType<typeof vi.fn>;

function serviceMock(name: string): TaskServiceMock {
  return vi.mocked(application[name as keyof typeof application] as TaskServiceMock);
}

function createDependencies() {
  return {
    createUserClient: vi.fn().mockReturnValue({} as SupabaseClient<McpDatabase>),
  };
}

function createHandlers() {
  const deps = createDependencies();
  return { deps, handlers: createTaskMcpWriteHandlers(deps) };
}

function authInfoFor(principal: McpPrincipal = PRINCIPAL): AuthInfo {
  return createMcpAuthInfo(ACCESS_TOKEN, principal);
}

function structured(result: { structuredContent?: unknown }) {
  return result.structuredContent as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MCP task write module authorization", () => {
  it("rejects unauthenticated createTask calls with UNAUTHENTICATED", async () => {
    const { handlers } = createHandlers();

    const result = await handlers.createTask(undefined, {
      title: "T",
      projectId: "project-1",
    });

    expect(structured(result)).toEqual({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Authentication is required for this tool." },
    });
    expect(result.isError).toBe(true);
    expect(serviceMock("createTask")).not.toHaveBeenCalled();
  });

  it("rejects auth context without an EGA principal with UNAUTHENTICATED", async () => {
    const { handlers } = createHandlers();
    const authInfo = { token: ACCESS_TOKEN, clientId: "hermes-client", scopes: [] } as unknown as AuthInfo;

    const result = await handlers.getTask(authInfo, { taskId: "task-1" });

    expect(structured(result)).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(serviceMock("getTaskReadModel")).not.toHaveBeenCalled();
  });

  it("rejects missing tasks.create permission with PERMISSION_DENIED", async () => {
    const { handlers } = createHandlers();

    const result = await handlers.createTask(authInfoFor(READ_ONLY_PRINCIPAL), {
      title: "T",
      projectId: "project-1",
    });

    expect(structured(result)).toEqual({
      ok: false,
      error: {
        code: "PERMISSION_DENIED",
        message: "The active EGA grant does not allow tasks.create.",
      },
    });
    expect(serviceMock("createTask")).not.toHaveBeenCalled();
  });

  it("rejects missing tasks.update permission for archiveTask with PERMISSION_DENIED", async () => {
    const { handlers } = createHandlers();

    const result = await handlers.archiveTask(authInfoFor(READ_ONLY_PRINCIPAL), { taskId: "task-1" });

    expect(structured(result)).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    expect(serviceMock("archiveTask")).not.toHaveBeenCalled();
  });
});

describe("MCP createTask handler", () => {
  it("delegates to canonical createTask with actor derived from principal ownerUserId and full input", async () => {
    const { deps, handlers } = createHandlers();
    serviceMock("createTask").mockResolvedValue(applicationSuccess(TASK_RECORD));

    const input = {
      title: "Repair the greenhouse door",
      projectId: "project-1",
      goalId: "goal-1",
      description: "Hinge is loose",
      status: "todo",
      priority: "high",
      dueDate: "2026-09-02",
      estimateMinutes: 45,
    };
    const result = await handlers.createTask(authInfoFor(), input);

    expect(deps.createUserClient).toHaveBeenCalledWith(ACCESS_TOKEN);
    const createTaskMock = serviceMock("createTask");
    expect(createTaskMock).toHaveBeenCalledTimes(1);
    const [actor, repository, serviceInput] = createTaskMock.mock.calls[0];
    expect(actor).toEqual({ userId: OWNER_USER_ID });
    expect(repository).toBeInstanceOf(SupabaseTasksRepository);
    expect(serviceInput).toEqual(input);
    expect(structured(result)).toEqual({ ok: true, task: TASK_RECORD });
    expect(result.isError).toBeUndefined();
  });

  it("maps canonical foreign-project rejection to INVALID_ARGUMENT with the canonical message", async () => {
    const { handlers } = createHandlers();
    serviceMock("createTask").mockResolvedValue(
      applicationFailure("Selected project is unavailable."),
    );

    const result = await handlers.createTask(authInfoFor(), {
      title: "T",
      projectId: "foreign-project",
    });

    expect(structured(result)).toEqual({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "Selected project is unavailable." },
    });
    expect(result.isError).toBe(true);
  });

  it("maps canonical invalid priority rejection message", async () => {
    const { handlers } = createHandlers();
    serviceMock("createTask").mockResolvedValue(
      applicationFailure("Task priority is invalid."),
    );

    const result = await handlers.createTask(authInfoFor(), {
      title: "T",
      projectId: "project-1",
      priority: "catastrophic",
    });

    expect(structured(result)).toEqual({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "Task priority is invalid." },
    });
  });

  it("maps canonical invalid status rejection message", async () => {
    const { handlers } = createHandlers();
    serviceMock("createTask").mockResolvedValue(
      applicationFailure("Task status is invalid."),
    );

    const result = await handlers.createTask(authInfoFor(), {
      title: "T",
      projectId: "project-1",
      status: "archived",
    });

    expect(structured(result)).toEqual({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "Task status is invalid." },
    });
  });
});

describe("MCP updateTask handler", () => {
  it("delegates to canonical updateTask with all mutable fields", async () => {
    const { handlers } = createHandlers();
    serviceMock("updateTask").mockResolvedValue(applicationSuccess(TASK_RECORD));

    const input = {
      taskId: "task-1",
      title: "Renamed task",
      description: "Updated",
      blockedReason: "Waiting on parts",
      status: "blocked",
      priority: "urgent",
      dueDate: "2026-09-10",
      estimateMinutes: 90,
      projectId: "project-1",
      goalId: "goal-1",
    };
    const result = await handlers.updateTask(authInfoFor(), input);

    const updateTaskMock = serviceMock("updateTask");
    expect(updateTaskMock).toHaveBeenCalledTimes(1);
    const [actor, repository, serviceInput] = updateTaskMock.mock.calls[0];
    expect(actor).toEqual({ userId: OWNER_USER_ID });
    expect(repository).toBeInstanceOf(SupabaseTasksRepository);
    expect(serviceInput).toEqual(input);
    expect(structured(result)).toEqual({ ok: true, task: TASK_RECORD });
  });
});

describe("MCP getTask handler", () => {
  it("returns the canonical owner-scoped mobile task item", async () => {
    const { handlers } = createHandlers();
    const item = toMobileTaskListItem(TASK_RECORD);
    serviceMock("getTaskReadModel").mockResolvedValue(applicationSuccess(item));

    const result = await handlers.getTask(authInfoFor(), { taskId: "task-1" });

    const readModelMock = serviceMock("getTaskReadModel");
    expect(readModelMock).toHaveBeenCalledTimes(1);
    const [actor, repository, taskId] = readModelMock.mock.calls[0];
    expect(actor).toEqual({ userId: OWNER_USER_ID });
    expect(repository).toBeInstanceOf(SupabaseTasksRepository);
    expect(taskId).toBe("task-1");
    expect(structured(result)).toEqual({ ok: true, task: item });
  });

  it("maps a missing task to NOT_FOUND", async () => {
    const { handlers } = createHandlers();
    serviceMock("getTaskReadModel").mockResolvedValue(applicationSuccess(null));

    const result = await handlers.getTask(authInfoFor(), { taskId: "missing-task" });

    expect(structured(result)).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "Task not found." },
    });
    expect(result.isError).toBe(true);
  });
});

describe("MCP archive/unarchive handlers", () => {
  it("delegates archiveTask to the canonical archive service", async () => {
    const { handlers } = createHandlers();
    serviceMock("archiveTask").mockResolvedValue(
      applicationSuccess({ ...TASK_RECORD, archivedAt: "2026-08-28T01:00:00.000Z" }),
    );

    const result = await handlers.archiveTask(authInfoFor(), { taskId: "task-1" });

    const archiveMock = serviceMock("archiveTask");
    expect(archiveMock).toHaveBeenCalledTimes(1);
    const [actor, repository, input] = archiveMock.mock.calls[0];
    expect(actor).toEqual({ userId: OWNER_USER_ID });
    expect(repository).toBeInstanceOf(SupabaseTasksRepository);
    expect(input).toEqual({ taskId: "task-1" });
    expect(structured(result)).toMatchObject({ ok: true, task: { id: "task-1" } });
  });

  it("delegates unarchiveTask to the canonical unarchive service", async () => {
    const { handlers } = createHandlers();
    serviceMock("unarchiveTask").mockResolvedValue(applicationSuccess(TASK_RECORD));

    const result = await handlers.unarchiveTask(authInfoFor(), { taskId: "task-1" });

    const unarchiveMock = serviceMock("unarchiveTask");
    expect(unarchiveMock).toHaveBeenCalledTimes(1);
    const [actor, repository, input] = unarchiveMock.mock.calls[0];
    expect(actor).toEqual({ userId: OWNER_USER_ID });
    expect(repository).toBeInstanceOf(SupabaseTasksRepository);
    expect(input).toEqual({ taskId: "task-1" });
    expect(structured(result)).toEqual({ ok: true, task: TASK_RECORD });
  });
});

describe("MCP setTaskFocusRank handler", () => {
  it("pins through the canonical focus service", async () => {
    const { handlers } = createHandlers();
    const pinnedItem = toMobileTaskListItem({ ...TASK_RECORD, focusRank: 3 });
    serviceMock("pinTask").mockResolvedValue(
      applicationSuccess({ ok: true as const, task: pinnedItem }),
    );

    const result = await handlers.setTaskFocusRank(authInfoFor(), { taskId: "task-1", pinned: true });

    const pinMock = serviceMock("pinTask");
    expect(pinMock).toHaveBeenCalledTimes(1);
    const [actor, repository, input] = pinMock.mock.calls[0];
    expect(actor).toEqual({ userId: OWNER_USER_ID });
    expect(repository).toBeInstanceOf(SupabaseTasksRepository);
    expect(input).toEqual({ taskId: "task-1" });
    expect(serviceMock("unpinTask")).not.toHaveBeenCalled();
    expect(structured(result)).toEqual({ ok: true, task: pinnedItem });
  });

  it("unpins through the canonical focus service", async () => {
    const { handlers } = createHandlers();
    const unpinnedItem = toMobileTaskListItem(TASK_RECORD);
    serviceMock("unpinTask").mockResolvedValue(
      applicationSuccess({ ok: true as const, task: unpinnedItem }),
    );

    const result = await handlers.setTaskFocusRank(authInfoFor(), { taskId: "task-1", pinned: false });

    expect(serviceMock("pinTask")).not.toHaveBeenCalled();
    expect(serviceMock("unpinTask")).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      expect.any(SupabaseTasksRepository),
      { taskId: "task-1" },
    );
    expect(structured(result)).toEqual({ ok: true, task: unpinnedItem });
  });

  it("maps canonical focus rejection (missing task) to INVALID_ARGUMENT", async () => {
    const { handlers } = createHandlers();
    serviceMock("pinTask").mockResolvedValue(applicationFailure("Selected task is unavailable."));

    const result = await handlers.setTaskFocusRank(authInfoFor(), { taskId: "missing", pinned: true });

    expect(structured(result)).toEqual({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "Selected task is unavailable." },
    });
  });
});

describe("MCP reminder handlers", () => {
  it("creates reminders through the canonical service with actor ownership", async () => {
    const { handlers } = createHandlers();
    const withReminder: TaskRecord = {
      ...TASK_RECORD,
      reminders: [
        {
          id: "reminder-1",
          taskId: "task-1",
          remindAt: "2026-09-01T09:00:00.000Z",
          channel: "email",
          status: "pending",
          sentAt: null,
          failureReason: null,
        },
      ],
    };
    serviceMock("createTaskReminder").mockResolvedValue(applicationSuccess(withReminder));

    const result = await handlers.createTaskReminder(authInfoFor(), {
      taskId: "task-1",
      remindAt: "2026-09-01T09:00:00.000Z",
    });

    const reminderMock = serviceMock("createTaskReminder");
    expect(reminderMock).toHaveBeenCalledTimes(1);
    const [actor, repository, input] = reminderMock.mock.calls[0];
    expect(actor).toEqual({ userId: OWNER_USER_ID });
    expect(repository).toBeInstanceOf(SupabaseTasksRepository);
    expect(input).toEqual({ taskId: "task-1", remindAt: "2026-09-01T09:00:00.000Z" });
    expect(structured(result)).toEqual({ ok: true, task: withReminder });
  });

  it("maps canonical reminder-time rejection to INVALID_ARGUMENT", async () => {
    const { handlers } = createHandlers();
    serviceMock("createTaskReminder").mockResolvedValue(
      applicationFailure("Reminder time must be in the future."),
    );

    const result = await handlers.createTaskReminder(authInfoFor(), {
      taskId: "task-1",
      remindAt: "2020-01-01T00:00:00.000Z",
    });

    expect(structured(result)).toEqual({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "Reminder time must be in the future." },
    });
  });

  it("cancels reminders through the canonical service with actor ownership", async () => {
    const { handlers } = createHandlers();
    serviceMock("cancelTaskReminder").mockResolvedValue(applicationSuccess(TASK_RECORD));

    const result = await handlers.cancelTaskReminder(authInfoFor(), {
      taskId: "task-1",
      reminderId: "reminder-1",
    });

    const cancelMock = serviceMock("cancelTaskReminder");
    expect(cancelMock).toHaveBeenCalledTimes(1);
    const [actor, repository, input] = cancelMock.mock.calls[0];
    expect(actor).toEqual({ userId: OWNER_USER_ID });
    expect(repository).toBeInstanceOf(SupabaseTasksRepository);
    expect(input).toEqual({ taskId: "task-1", reminderId: "reminder-1" });
    expect(structured(result)).toEqual({ ok: true, task: TASK_RECORD });
  });

  it("maps canonical reminder cancel rejection to INVALID_ARGUMENT", async () => {
    const { handlers } = createHandlers();
    serviceMock("cancelTaskReminder").mockResolvedValue(
      applicationFailure("Unable to cancel reminder right now."),
    );

    const result = await handlers.cancelTaskReminder(authInfoFor(), {
      taskId: "task-1",
      reminderId: "reminder-404",
    });

    expect(structured(result)).toEqual({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "Unable to cancel reminder right now." },
    });
  });
});
