import type { AuthInfo } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import {
  updateTask as updateTaskUseCase,
  type TasksRepository,
} from "@ega/application";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { createTaskMcpWriteHandlers } from "@/lib/mcp/write/tasks";
import { validateTaskInlineUpdateInput } from "@/lib/services/task-service";

/**
 * Cross-transport task-write parity.
 *
 * Web actions gate every edit through `validateTaskInlineUpdateInput` before
 * `updateTaskInline`; Hono and MCP both delegate to the canonical application
 * `updateTask` use case. These tests pin the shared rejection contract so a
 * rule cannot drift between the web field editor and the API/MCP surfaces.
 */

const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
const ACCESS_TOKEN = "parity-token";

const PRINCIPAL: McpPrincipal = {
  ownerUserId: OWNER_USER_ID,
  oauthClientId: "parity-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "task_manager",
  permissionsVersion: 1,
  permissions: [
    "projects.read",
    "goals.read",
    "tasks.read",
    "tasks.create",
    "tasks.update",
  ],
};

function authInfoFor(principal: McpPrincipal = PRINCIPAL): AuthInfo {
  return createMcpAuthInfo(ACCESS_TOKEN, principal);
}

function createMcpHandlers() {
  return createTaskMcpWriteHandlers({
    createUserClient: () => ({}) as never,
  });
}

/** Repository that fails the test if a rejected input reaches persistence. */
function createUnreachableRepository(): TasksRepository {
  const fail = () => {
    throw new Error("A rejected task input must not reach the repository.");
  };
  return {
    getScope: fail,
    listTasks: fail,
    listProjectOptions: fail,
    listGoalOptions: fail,
    getTask: fail,
    createTask: fail,
    updateTask: fail,
    setTaskArchived: fail,
    createReminder: fail,
    findReminderByOperation: fail,
    cancelReminder: fail,
    getFocusRank: fail,
    getMaxFocusRank: fail,
    setFocusRank: fail,
  };
}

function structured(result: { structuredContent?: unknown }) {
  return result.structuredContent as {
    ok: boolean;
    error?: { code: string; message: string };
  };
}

describe("task write validation parity", () => {
  it("rejects blocked without reason with the same canonical message on Web, application and MCP", async () => {
    const expected = "Blocked reason is required when status is Blocked.";

    // Web action + field-patch gate.
    expect(
      validateTaskInlineUpdateInput({
        taskId: "task-1",
        status: "blocked",
        priority: "medium",
        dueDate: "",
        estimateMinutes: "",
        blockedReason: " ",
      }).errorMessage,
    ).toBe(expected);

    // Hono + MCP authority.
    const applicationResult = await updateTaskUseCase(
      { userId: OWNER_USER_ID },
      createUnreachableRepository(),
      { taskId: "task-1", status: "blocked" },
    );
    expect(!applicationResult.ok && applicationResult.errorMessage).toBe(expected);

    // MCP transport, real handler + real use case (no service mock).
    const mcpResult = await createMcpHandlers().updateTask(authInfoFor(), {
      taskId: "task-1",
      status: "blocked",
    });
    expect(mcpResult.isError).toBe(true);
    expect(structured(mcpResult).error).toEqual({
      code: "INVALID_ARGUMENT",
      message: expected,
    });
  });

  it("rejects an empty title with the same canonical message on Web, application and MCP", async () => {
    const expected = "Task title is required.";

    expect(
      validateTaskInlineUpdateInput({
        taskId: "task-1",
        title: "   ",
        status: "todo",
        priority: "medium",
        dueDate: "",
        estimateMinutes: "",
        blockedReason: "",
      }).errorMessage,
    ).toBe(expected);

    const applicationResult = await updateTaskUseCase(
      { userId: OWNER_USER_ID },
      createUnreachableRepository(),
      { taskId: "task-1", title: "   " },
    );
    expect(!applicationResult.ok && applicationResult.errorMessage).toBe(expected);

    const mcpResult = await createMcpHandlers().updateTask(authInfoFor(), {
      taskId: "task-1",
      title: "   ",
    });
    expect(structured(mcpResult).error).toEqual({
      code: "INVALID_ARGUMENT",
      message: expected,
    });
  });

  it("rejects an invalid priority on every transport without persistence", async () => {
    expect(
      validateTaskInlineUpdateInput({
        taskId: "task-1",
        status: "todo",
        priority: "asap",
        dueDate: "",
        estimateMinutes: "",
        blockedReason: "",
      }).errorMessage,
    ).toMatch(/^Priority must be one of:/);

    const applicationResult = await updateTaskUseCase(
      { userId: OWNER_USER_ID },
      createUnreachableRepository(),
      { taskId: "task-1", priority: "asap" },
    );
    expect(applicationResult.ok).toBe(false);

    const mcpResult = await createMcpHandlers().updateTask(authInfoFor(), {
      taskId: "task-1",
      priority: "asap",
    });
    expect(structured(mcpResult).ok).toBe(false);
  });

  it("rejects missing tasks.update permission before validation or persistence", async () => {
    const readOnly: McpPrincipal = {
      ...PRINCIPAL,
      permissionProfile: "read_only",
      permissions: ["projects.read", "goals.read", "tasks.read"],
    };

    const result = await createMcpHandlers().updateTask(authInfoFor(readOnly), {
      taskId: "task-1",
      status: "blocked",
    });

    expect(result.isError).toBe(true);
    expect(structured(result).error?.code).toBe("PERMISSION_DENIED");
  });
});
