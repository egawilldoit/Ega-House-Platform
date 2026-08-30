import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/server";

import {
  archiveGoal,
  createGoal,
  unarchiveGoal,
  updateGoalHealth,
  updateGoalNextStep,
  updateGoalStatus,
} from "@ega/application";
import { SupabaseGoalsRepository } from "@ega/data-access";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { McpToolAuthorizationError } from "@/lib/mcp/tool-authorization";
import * as goalsWrite from "@/lib/mcp/write/goals";
import type { McpWriteModuleDeps } from "@/lib/mcp/write/goals";

vi.mock("@ega/application", () => ({
  archiveGoal: vi.fn(),
  createGoal: vi.fn(),
  unarchiveGoal: vi.fn(),
  updateGoalHealth: vi.fn(),
  updateGoalNextStep: vi.fn(),
  updateGoalStatus: vi.fn(),
}));

vi.mock("@ega/data-access", () => ({
  SupabaseGoalsRepository: vi.fn(),
}));

const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";

const WORKSPACE_MANAGER_PRINCIPAL: McpPrincipal = {
  ownerUserId: OWNER_USER_ID,
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "workspace_manager",
  permissionsVersion: 1,
  permissions: [
    "projects.read",
    "projects.create",
    "projects.update",
    "goals.read",
    "goals.create",
    "goals.update",
    "tasks.read",
    "today.read",
    "timer.read",
  ],
};

const READ_ONLY_PRINCIPAL: McpPrincipal = {
  ownerUserId: OWNER_USER_ID,
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "read_only",
  permissionsVersion: 1,
  permissions: ["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"],
};

function makeDeps(): { deps: McpWriteModuleDeps; client: Record<string, never> } {
  const client = {} as Record<string, never>;
  return {
    client,
    deps: {
      createUserClient: vi.fn().mockReturnValue(client),
    } as unknown as McpWriteModuleDeps,
  };
}

function makeRepository() {
  const repository = {};
  vi.mocked(SupabaseGoalsRepository).mockImplementation(
    function () {
      return repository as never;
    } as never,
  );
  return repository;
}

function expectUnauthorized(
  error: unknown,
  code: "UNAUTHENTICATED" | "PERMISSION_DENIED",
) {
  expect(error).toBeInstanceOf(McpToolAuthorizationError);
  expect((error as McpToolAuthorizationError).code).toBe(code);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mcp write goals.createGoal", () => {
  it("delegates to the canonical application createGoal with the principal-derived actor and repository", async () => {
    const repository = makeRepository();
    const { deps, client } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    const goalValues = {
      title: "Ship MCP writes",
      projectId: "project-1",
      description: "Goal description",
      nextStep: "Write tests",
      health: "on_track",
      status: "draft",
      slug: "ship-mcp-writes",
    };
    vi.mocked(createGoal).mockResolvedValue({ ok: true, data: null, values: goalValues });

    const result = await goalsWrite.createGoal(
      authInfo,
      {
        title: "Ship MCP writes",
        projectId: "project-1",
        description: "Goal description",
        nextStep: "Write tests",
        health: "on_track",
        slug: "Ship MCP Writes",
      },
      deps,
    );

    expect(deps.createUserClient).toHaveBeenCalledWith("token-123");
    expect(SupabaseGoalsRepository).toHaveBeenCalledWith(client);
    expect(createGoal).toHaveBeenCalledTimes(1);
    expect(createGoal).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      repository,
      {
        title: "Ship MCP writes",
        projectId: "project-1",
        description: "Goal description",
        nextStep: "Write tests",
        health: "on_track",
        status: undefined,
        slug: "Ship MCP Writes",
      },
    );
    expect(result.structuredContent).toEqual({ ok: true, goal: goalValues });
  });

  it("binds createGoal to the verified MCP client and operation", async () => {
    const repository = makeRepository();
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    const goalRecord = {
      id: "goal-1",
      projectId: "project-1",
      title: "Ship MCP writes",
      slug: "ship-mcp-writes",
      description: null,
      nextStep: null,
      health: null,
      status: "draft",
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    };
    vi.mocked(createGoal).mockResolvedValue({
      ok: true,
      data: goalRecord,
      values: {
        title: "Ship MCP writes",
        projectId: "project-1",
        description: "",
        nextStep: "",
        health: "",
        status: "draft",
        slug: "ship-mcp-writes",
      },
    });

    const result = await goalsWrite.createGoal(
      authInfo,
      {
        title: "Ship MCP writes",
        projectId: "project-1",
        operationId: "550e8400-e29b-41d4-a716-446655440000",
      },
      deps,
    );

    expect(createGoal).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      repository,
      expect.objectContaining({
        mcpOperationId: "550e8400-e29b-41d4-a716-446655440000",
        mcpClientId: "hermes-client",
      }),
    );
    expect(result.structuredContent).toEqual({ ok: true, goal: goalRecord });
  });

  it("keeps goal-project relationship authority inside the canonical service", async () => {
    makeRepository();
    const { deps, client } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(createGoal).mockResolvedValue({
      ok: false,
      errorMessage: "Project is required.",
      values: {
        title: "Ship MCP writes",
        projectId: "",
        description: "",
        nextStep: "",
        health: "",
        status: "draft",
        slug: "",
      },
    });

    const result = await goalsWrite.createGoal(
      authInfo,
      { title: "Ship MCP writes", projectId: "not-validated-here" },
      deps,
    );

    expect(SupabaseGoalsRepository).toHaveBeenCalledWith(client);
    expect(createGoal).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "Project is required." },
    });
  });

  it("ignores caller-supplied user identity and fails closed on the principal owner", async () => {
    makeRepository();
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(createGoal).mockResolvedValue({
      ok: true,
      data: null,
      values: {
        title: "Ship MCP writes",
        projectId: "project-1",
        description: "",
        nextStep: "",
        health: "",
        status: "draft",
        slug: "",
      },
    });

    await goalsWrite.createGoal(
      authInfo,
      { title: "Ship MCP writes", projectId: "project-1", userId: "attacker-user-id" } as never,
      deps,
    );

    const [actor] = vi.mocked(createGoal).mock.calls[0];
    expect(actor).toEqual({ userId: OWNER_USER_ID });
  });

  it("denies a principal without goals.create", async () => {
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", READ_ONLY_PRINCIPAL);

    await expect(
      goalsWrite.createGoal(authInfo, { title: "t", projectId: "p" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    try {
      await goalsWrite.createGoal(authInfo, { title: "t", projectId: "p" }, deps);
    } catch (error) {
      expectUnauthorized(error, "PERMISSION_DENIED");
    }
    expect(createGoal).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated call", async () => {
    const { deps } = makeDeps();

    await expect(
      goalsWrite.createGoal(undefined, { title: "t", projectId: "p" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    try {
      await goalsWrite.createGoal(undefined, { title: "t", projectId: "p" }, deps);
    } catch (error) {
      expectUnauthorized(error, "UNAUTHENTICATED");
    }
    expect(createGoal).not.toHaveBeenCalled();
  });

  it("rejects an auth context without an EGA principal", async () => {
    const { deps } = makeDeps();
    const authInfo = {
      token: "token-123",
      clientId: "hermes-client",
      scopes: ["ega.mcp.authorized"],
    } as AuthInfo;

    await expect(
      goalsWrite.createGoal(authInfo, { title: "t", projectId: "p" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    try {
      await goalsWrite.createGoal(authInfo, { title: "t", projectId: "p" }, deps);
    } catch (error) {
      expectUnauthorized(error, "UNAUTHENTICATED");
    }
    expect(createGoal).not.toHaveBeenCalled();
  });
});

describe("mcp write goals.updateGoalStatus", () => {
  it("calls the canonical application updateGoalStatus and maps success", async () => {
    const repository = makeRepository();
    const { deps, client } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(updateGoalStatus).mockResolvedValue({ ok: true, data: null });

    const result = await goalsWrite.updateGoalStatus(
      authInfo,
      { goalId: "goal-1", status: "active" },
      deps,
    );

    expect(SupabaseGoalsRepository).toHaveBeenCalledWith(client);
    expect(updateGoalStatus).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      repository,
      { goalId: "goal-1", status: "active" },
    );
    expect(result.structuredContent).toEqual({
      ok: true,
      goal: { id: "goal-1", status: "active" },
    });
  });

  it("maps an application failure to an INVALID_ARGUMENT error payload", async () => {
    makeRepository();
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(updateGoalStatus).mockResolvedValue({
      ok: false,
      errorMessage: "Unable to update goal right now.",
    });

    const result = await goalsWrite.updateGoalStatus(
      authInfo,
      { goalId: "goal-1", status: "active" },
      deps,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: "INVALID_ARGUMENT",
        message: "Unable to update goal right now.",
      },
    });
  });

  it("denies a principal without goals.update", async () => {
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", READ_ONLY_PRINCIPAL);

    await expect(
      goalsWrite.updateGoalStatus(authInfo, { goalId: "goal-1", status: "active" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    try {
      await goalsWrite.updateGoalStatus(
        authInfo,
        { goalId: "goal-1", status: "active" },
        deps,
      );
    } catch (error) {
      expectUnauthorized(error, "PERMISSION_DENIED");
    }
    expect(updateGoalStatus).not.toHaveBeenCalled();
  });
});

describe("mcp write goals.updateGoalHealth", () => {
  it("calls the canonical application updateGoalHealth and maps success", async () => {
    const repository = makeRepository();
    const { deps, client } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(updateGoalHealth).mockResolvedValue({ ok: true, data: null });

    const result = await goalsWrite.updateGoalHealth(
      authInfo,
      { goalId: "goal-1", health: "at_risk" },
      deps,
    );

    expect(SupabaseGoalsRepository).toHaveBeenCalledWith(client);
    expect(updateGoalHealth).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      repository,
      { goalId: "goal-1", health: "at_risk" },
    );
    expect(result.structuredContent).toEqual({ ok: true, goal: { id: "goal-1" } });
  });

  it("denies a principal without goals.update", async () => {
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", READ_ONLY_PRINCIPAL);

    await expect(
      goalsWrite.updateGoalHealth(authInfo, { goalId: "goal-1", health: "at_risk" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    expect(updateGoalHealth).not.toHaveBeenCalled();
  });
});

describe("mcp write goals.updateGoalNextStep", () => {
  it("calls the canonical application updateGoalNextStep and maps success", async () => {
    const repository = makeRepository();
    const { deps, client } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(updateGoalNextStep).mockResolvedValue({ ok: true, data: null });

    const result = await goalsWrite.updateGoalNextStep(
      authInfo,
      { goalId: "goal-1", nextStep: "Review PR" },
      deps,
    );

    expect(SupabaseGoalsRepository).toHaveBeenCalledWith(client);
    expect(updateGoalNextStep).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      repository,
      { goalId: "goal-1", nextStep: "Review PR" },
    );
    expect(result.structuredContent).toEqual({ ok: true, goal: { id: "goal-1" } });
  });

  it("denies a principal without goals.update", async () => {
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", READ_ONLY_PRINCIPAL);

    await expect(
      goalsWrite.updateGoalNextStep(authInfo, { goalId: "goal-1", nextStep: "x" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    expect(updateGoalNextStep).not.toHaveBeenCalled();
  });
});

describe("mcp write goals.archiveGoal", () => {
  it("calls the canonical application archiveGoal and maps success", async () => {
    const repository = makeRepository();
    const { deps, client } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(archiveGoal).mockResolvedValue({ ok: true, data: null });

    const result = await goalsWrite.archiveGoal(authInfo, { goalId: "goal-1" }, deps);

    expect(SupabaseGoalsRepository).toHaveBeenCalledWith(client);
    expect(archiveGoal).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      repository,
      { goalId: "goal-1" },
    );
    expect(result.structuredContent).toEqual({
      ok: true,
      goal: { id: "goal-1", status: "archived" },
    });
  });

  it("denies a principal without goals.update", async () => {
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", READ_ONLY_PRINCIPAL);

    await expect(
      goalsWrite.archiveGoal(authInfo, { goalId: "goal-1" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    expect(archiveGoal).not.toHaveBeenCalled();
  });
});

describe("mcp write goals.unarchiveGoal", () => {
  it("calls the canonical application unarchiveGoal and maps success", async () => {
    const repository = makeRepository();
    const { deps, client } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(unarchiveGoal).mockResolvedValue({ ok: true, data: null });

    const result = await goalsWrite.unarchiveGoal(authInfo, { goalId: "goal-1" }, deps);

    expect(SupabaseGoalsRepository).toHaveBeenCalledWith(client);
    expect(unarchiveGoal).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      repository,
      { goalId: "goal-1" },
    );
    expect(result.structuredContent).toEqual({
      ok: true,
      goal: { id: "goal-1", status: "active" },
    });
  });

  it("denies a principal without goals.update", async () => {
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", READ_ONLY_PRINCIPAL);

    await expect(
      goalsWrite.unarchiveGoal(authInfo, { goalId: "goal-1" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    expect(unarchiveGoal).not.toHaveBeenCalled();
  });
});
