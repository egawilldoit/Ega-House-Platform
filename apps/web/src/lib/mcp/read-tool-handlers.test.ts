import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpPrincipal } from "@/lib/mcp/principal";
import {
  createMcpReadToolHandlers,
  type McpReadToolDependencies,
} from "@/lib/mcp/read-tool-handlers";

const PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-0000-0000-000000000001",
  oauthClientId: "test-mcp-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "read_only",
  permissionsVersion: 1,
  permissions: ["projects.read", "goals.read", "tasks.read"],
};

function createDependencies(): McpReadToolDependencies {
  return {
    createUserClient: vi.fn().mockReturnValue({} as SupabaseClient<McpDatabase>),
    listProjects: vi.fn().mockResolvedValue([
      {
        id: "project-1",
        name: "EGA House",
        slug: "ega-house",
        description: null,
        status: "active",
        createdAt: "2026-07-29T10:00:00Z",
        updatedAt: "2026-07-29T11:00:00Z",
      },
    ]),
    listGoals: vi.fn().mockResolvedValue([]),
    listTasks: vi.fn().mockResolvedValue([]),
  };
}

function readStructuredContent(result: { structuredContent?: unknown }) {
  return result.structuredContent;
}

describe("MCP read tool handlers", () => {
  it("returns grant capabilities without creating a database client", async () => {
    const dependencies = createDependencies();
    const handlers = createMcpReadToolHandlers(dependencies, false);
    const authInfo = createMcpAuthInfo("test-bearer", PRINCIPAL);

    const result = await handlers.getCapabilities(authInfo);

    expect(readStructuredContent(result)).toEqual({
      ok: true,
      permissionProfile: "read_only",
      permissionsVersion: 1,
      permissions: ["projects.read", "goals.read", "tasks.read"],
      writesEnabled: false,
    });
    expect(dependencies.createUserClient).not.toHaveBeenCalled();
  });

  it("lists projects using the caller bearer token and owner identity", async () => {
    const dependencies = createDependencies();
    const handlers = createMcpReadToolHandlers(dependencies, false);
    const authInfo = createMcpAuthInfo("test-bearer", PRINCIPAL);

    const result = await handlers.listProjects(authInfo, { limit: 25 });

    expect(dependencies.createUserClient).toHaveBeenCalledWith("test-bearer");
    expect(dependencies.listProjects).toHaveBeenCalledWith(
      expect.anything(),
      PRINCIPAL.ownerUserId,
      25,
    );
    expect(readStructuredContent(result)).toEqual({
      ok: true,
      projects: [expect.objectContaining({ id: "project-1" })],
      count: 1,
    });
  });

  it("passes goal filters to the owner-scoped repository", async () => {
    const dependencies = createDependencies();
    const handlers = createMcpReadToolHandlers(dependencies, false);
    const authInfo = createMcpAuthInfo("test-bearer", PRINCIPAL);

    await handlers.listGoals(authInfo, {
      projectId: "project-1",
      limit: 10,
    });

    expect(dependencies.listGoals).toHaveBeenCalledWith(
      expect.anything(),
      PRINCIPAL.ownerUserId,
      { projectId: "project-1", limit: 10 },
    );
  });

  it("passes task filters to the owner-scoped repository", async () => {
    const dependencies = createDependencies();
    const handlers = createMcpReadToolHandlers(dependencies, false);
    const authInfo = createMcpAuthInfo("test-bearer", PRINCIPAL);

    await handlers.listTasks(authInfo, {
      projectId: "project-1",
      status: "in_progress",
      includeArchived: false,
      limit: 20,
    });

    expect(dependencies.listTasks).toHaveBeenCalledWith(
      expect.anything(),
      PRINCIPAL.ownerUserId,
      {
        projectId: "project-1",
        status: "in_progress",
        includeArchived: false,
        limit: 20,
      },
    );
  });

  it("returns a structured permission error before creating a client", async () => {
    const dependencies = createDependencies();
    const handlers = createMcpReadToolHandlers(dependencies, false);
    const unauthorized: AuthInfo = {
      token: "test-bearer",
      clientId: "test-mcp-client",
      scopes: [],
      extra: {},
    };

    const result = await handlers.listProjects(unauthorized, { limit: 25 });

    expect(result.isError).toBe(true);
    expect(readStructuredContent(result)).toEqual({
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required for this tool.",
      },
    });
    expect(dependencies.createUserClient).not.toHaveBeenCalled();
  });

  it("redacts repository failures in tool responses", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.listProjects).mockRejectedValue(
      new Error("Failed to load EGA projects."),
    );
    const handlers = createMcpReadToolHandlers(dependencies, false);

    const result = await handlers.listProjects(
      createMcpAuthInfo("test-bearer", PRINCIPAL),
      { limit: 25 },
    );

    expect(result.isError).toBe(true);
    expect(readStructuredContent(result)).toEqual({
      ok: false,
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "EGA House data is temporarily unavailable.",
      },
    });
  });
});
