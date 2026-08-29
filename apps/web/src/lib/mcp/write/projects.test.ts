import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/server";

import {
  archiveProject,
  createProject,
  unarchiveProject,
  updateProjectStatus,
} from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { McpToolAuthorizationError } from "@/lib/mcp/tool-authorization";
import * as projectsWrite from "@/lib/mcp/write/projects";
import type { McpWriteModuleDeps } from "@/lib/mcp/write/projects";

vi.mock("@ega/application", () => ({
  archiveProject: vi.fn(),
  createProject: vi.fn(),
  unarchiveProject: vi.fn(),
  updateProjectStatus: vi.fn(),
}));

vi.mock("@ega/data-access", () => ({
  SupabaseProjectsRepository: vi.fn(),
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

function makeRepository(overrides: {
  getProjectBySlug?: ReturnType<typeof vi.fn>;
} = {}) {
  const repository = {
    getProjectBySlug:
      overrides.getProjectBySlug
      ?? vi.fn().mockResolvedValue({ ok: true, value: null }),
  };
  vi.mocked(SupabaseProjectsRepository).mockImplementation(
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

describe("mcp write projects.createProject", () => {
  it("calls the canonical application createProject with an actor derived from the principal", async () => {
    const { deps, client } = makeDeps();
    const repository = makeRepository();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(createProject).mockResolvedValue({
      ok: true,
      data: null,
      values: { name: "New Project", slug: "new-project", description: "" },
    });
    repository.getProjectBySlug.mockResolvedValue({
      ok: true,
      value: {
        id: "project-1",
        name: "New Project",
        slug: "new-project",
        description: null,
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await projectsWrite.createProject(
      authInfo,
      { name: "New Project" },
      deps,
    );
    const payload = result.structuredContent as Record<string, unknown>;

    expect(deps.createUserClient).toHaveBeenCalledWith("token-123");
    expect(SupabaseProjectsRepository).toHaveBeenCalledWith(client);
    expect(createProject).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      repository,
      { name: "New Project", slug: "New Project", description: undefined },
    );
    expect(repository.getProjectBySlug).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      "new-project",
    );
    expect(payload.ok).toBe(true);
    expect((payload.project as { id: string }).id).toBe("project-1");
  });

  it("ignores caller-supplied user identity and fails closed on the principal owner", async () => {
    makeRepository();
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(createProject).mockResolvedValue({
      ok: true,
      data: null,
      values: { name: "New Project", slug: "new-project", description: "" },
    });

    await projectsWrite.createProject(
      authInfo,
      { name: "New Project", userId: "attacker-user-id" } as never,
      deps,
    );

    const [actor] = vi.mocked(createProject).mock.calls[0];
    expect(actor).toEqual({ userId: OWNER_USER_ID });
  });

  it("maps an application failure to an INVALID_ARGUMENT error payload", async () => {
    makeRepository();
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(createProject).mockResolvedValue({
      ok: false,
      errorMessage: "That slug is already in use. Choose a different slug.",
      values: { name: "New Project", slug: "new-project", description: "" },
    });

    const result = await projectsWrite.createProject(
      authInfo,
      { name: "New Project", slug: "new-project" },
      deps,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: "INVALID_ARGUMENT",
        message: "That slug is already in use. Choose a different slug.",
      },
    });
  });

  it("falls back to the canonical form values when the read-back fails", async () => {
    const repository = makeRepository({
      getProjectBySlug: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "unknown" } }),
    });
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(createProject).mockResolvedValue({
      ok: true,
      data: null,
      values: { name: "New Project", slug: "new-project", description: "Desc" },
    });

    const result = await projectsWrite.createProject(
      authInfo,
      { name: "New Project" },
      deps,
    );
    const payload = result.structuredContent as Record<string, unknown>;

    expect(repository.getProjectBySlug).toHaveBeenCalled();
    expect(payload).toEqual({
      ok: true,
      project: { name: "New Project", slug: "new-project", description: "Desc" },
    });
  });

  it("denies a principal without projects.create", async () => {
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", READ_ONLY_PRINCIPAL);

    await expect(
      projectsWrite.createProject(authInfo, { name: "New Project" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    try {
      await projectsWrite.createProject(authInfo, { name: "New Project" }, deps);
    } catch (error) {
      expectUnauthorized(error, "PERMISSION_DENIED");
    }
    expect(createProject).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated call", async () => {
    const { deps } = makeDeps();

    await expect(
      projectsWrite.createProject(undefined, { name: "New Project" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    try {
      await projectsWrite.createProject(undefined, { name: "New Project" }, deps);
    } catch (error) {
      expectUnauthorized(error, "UNAUTHENTICATED");
    }
    expect(createProject).not.toHaveBeenCalled();
  });

  it("rejects an auth context without an EGA principal", async () => {
    const { deps } = makeDeps();
    const authInfo = {
      token: "token-123",
      clientId: "hermes-client",
      scopes: ["ega.mcp.authorized"],
    } as AuthInfo;

    await expect(
      projectsWrite.createProject(authInfo, { name: "New Project" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    try {
      await projectsWrite.createProject(authInfo, { name: "New Project" }, deps);
    } catch (error) {
      expectUnauthorized(error, "UNAUTHENTICATED");
    }
    expect(createProject).not.toHaveBeenCalled();
  });
});

describe("mcp write projects.updateProjectStatus", () => {
  it("calls the canonical application updateProjectStatus and maps success", async () => {
    const repository = makeRepository();
    const { deps, client } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(updateProjectStatus).mockResolvedValue({ ok: true, data: null });

    const result = await projectsWrite.updateProjectStatus(
      authInfo,
      { projectId: "project-1", status: "active" },
      deps,
    );

    expect(SupabaseProjectsRepository).toHaveBeenCalledWith(client);
    expect(updateProjectStatus).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      repository,
      { projectId: "project-1", status: "active" },
    );
    expect(result.structuredContent).toEqual({
      ok: true,
      project: { id: "project-1", status: "active" },
    });
  });

  it("maps an application failure to an INVALID_ARGUMENT error payload", async () => {
    makeRepository();
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(updateProjectStatus).mockResolvedValue({
      ok: false,
      errorMessage: "Unable to update project right now.",
    });

    const result = await projectsWrite.updateProjectStatus(
      authInfo,
      { projectId: "project-1", status: "active" },
      deps,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: "INVALID_ARGUMENT",
        message: "Unable to update project right now.",
      },
    });
  });

  it("denies a principal without projects.update", async () => {
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", READ_ONLY_PRINCIPAL);

    await expect(
      projectsWrite.updateProjectStatus(
        authInfo,
        { projectId: "project-1", status: "active" },
        deps,
      ),
    ).rejects.toThrow(McpToolAuthorizationError);
    try {
      await projectsWrite.updateProjectStatus(
        authInfo,
        { projectId: "project-1", status: "active" },
        deps,
      );
    } catch (error) {
      expectUnauthorized(error, "PERMISSION_DENIED");
    }
    expect(updateProjectStatus).not.toHaveBeenCalled();
  });
});

describe("mcp write projects.archiveProject", () => {
  it("calls the canonical application archiveProject and maps success", async () => {
    const repository = makeRepository();
    const { deps, client } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(archiveProject).mockResolvedValue({ ok: true, data: null });

    const result = await projectsWrite.archiveProject(
      authInfo,
      { projectId: "project-1" },
      deps,
    );

    expect(SupabaseProjectsRepository).toHaveBeenCalledWith(client);
    expect(archiveProject).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      repository,
      { projectId: "project-1" },
    );
    expect(result.structuredContent).toEqual({
      ok: true,
      project: { id: "project-1", status: "archived" },
    });
  });

  it("denies a principal without projects.update", async () => {
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", READ_ONLY_PRINCIPAL);

    await expect(
      projectsWrite.archiveProject(authInfo, { projectId: "project-1" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    expect(archiveProject).not.toHaveBeenCalled();
  });
});

describe("mcp write projects.unarchiveProject", () => {
  it("calls the canonical application unarchiveProject and maps success", async () => {
    const repository = makeRepository();
    const { deps, client } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", WORKSPACE_MANAGER_PRINCIPAL);
    vi.mocked(unarchiveProject).mockResolvedValue({ ok: true, data: null });

    const result = await projectsWrite.unarchiveProject(
      authInfo,
      { projectId: "project-1" },
      deps,
    );

    expect(SupabaseProjectsRepository).toHaveBeenCalledWith(client);
    expect(unarchiveProject).toHaveBeenCalledWith(
      { userId: OWNER_USER_ID },
      repository,
      { projectId: "project-1" },
    );
    expect(result.structuredContent).toEqual({
      ok: true,
      project: { id: "project-1", status: "active" },
    });
  });

  it("denies a principal without projects.update", async () => {
    const { deps } = makeDeps();
    const authInfo = createMcpAuthInfo("token-123", READ_ONLY_PRINCIPAL);

    await expect(
      projectsWrite.unarchiveProject(authInfo, { projectId: "project-1" }, deps),
    ).rejects.toThrow(McpToolAuthorizationError);
    expect(unarchiveProject).not.toHaveBeenCalled();
  });
});
