import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PROJECT_ARCHIVE_STATUS } from "@ega/domain";
import {
  archiveProject as archiveProjectInApplication,
  createProject as createProjectInApplication,
  unarchiveProject as unarchiveProjectInApplication,
  updateProjectStatus as updateProjectStatusInApplication,
  type AuthenticatedActor,
} from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import { requireMcpPermission } from "@/lib/mcp/tool-authorization";

export type McpWriteModuleDeps = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
};

type ToolPayload = Record<string, unknown>;

function toCallToolResult(payload: ToolPayload, isError = false): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };

  if (isError) {
    result.isError = true;
  }

  return result;
}

function applicationErrorResult(message: string): CallToolResult {
  return toCallToolResult(
    { ok: false, error: { code: "INVALID_ARGUMENT", message } },
    true,
  );
}

function resolveActor(
  authInfo: AuthInfo | undefined,
  permission: "projects.create" | "projects.update",
): AuthenticatedActor {
  const principal = requireMcpPermission(authInfo, permission);
  return { userId: principal.ownerUserId };
}

function createRepository(deps: McpWriteModuleDeps, authInfo: AuthInfo) {
  return new SupabaseProjectsRepository(deps.createUserClient(authInfo.token));
}

export async function createProject(
  authInfo: AuthInfo | undefined,
  input: { name?: string; slug?: string | null; description?: string | null; operationId?: string },
  deps: McpWriteModuleDeps,
): Promise<CallToolResult> {
  const principal = requireMcpPermission(authInfo, "projects.create");
  const actor: AuthenticatedActor = { userId: principal.ownerUserId };
  const repository = createRepository(deps, authInfo!);

  const result = await createProjectInApplication(actor, repository, {
    name: input.name,
    slug: input.slug ?? input.name,
    description: input.description,
    mcpOperationId: input.operationId ?? null,
    mcpClientId: principal.oauthClientId,
  } as unknown as { name: unknown; slug: unknown; description: unknown });

  if (!result.ok) {
    return applicationErrorResult(result.errorMessage);
  }

  const readBack = await repository.getProjectBySlug(actor, result.values.slug);
  const project =
    readBack.ok && readBack.value
      ? readBack.value
      : {
          name: result.values.name,
          slug: result.values.slug,
          description: result.values.description || null,
        };

  return toCallToolResult({ ok: true, project });
}

export async function updateProjectStatus(
  authInfo: AuthInfo | undefined,
  input: { projectId?: string; status?: string },
  deps: McpWriteModuleDeps,
): Promise<CallToolResult> {
  const actor = resolveActor(authInfo, "projects.update");
  const repository = createRepository(deps, authInfo!);

  const result = await updateProjectStatusInApplication(actor, repository, {
    projectId: input.projectId,
    status: input.status,
  });

  if (!result.ok) {
    return applicationErrorResult(result.errorMessage);
  }

  return toCallToolResult({
    ok: true,
    project: { id: input.projectId ?? "", status: input.status ?? "" },
  });
}

export async function archiveProject(
  authInfo: AuthInfo | undefined,
  input: { projectId?: string },
  deps: McpWriteModuleDeps,
): Promise<CallToolResult> {
  const actor = resolveActor(authInfo, "projects.update");
  const repository = createRepository(deps, authInfo!);

  const result = await archiveProjectInApplication(actor, repository, {
    projectId: input.projectId,
  });

  if (!result.ok) {
    return applicationErrorResult(result.errorMessage);
  }

  return toCallToolResult({
    ok: true,
    project: { id: input.projectId ?? "", status: PROJECT_ARCHIVE_STATUS },
  });
}

export async function unarchiveProject(
  authInfo: AuthInfo | undefined,
  input: { projectId?: string },
  deps: McpWriteModuleDeps,
): Promise<CallToolResult> {
  const actor = resolveActor(authInfo, "projects.update");
  const repository = createRepository(deps, authInfo!);

  const result = await unarchiveProjectInApplication(actor, repository, {
    projectId: input.projectId,
  });

  if (!result.ok) {
    return applicationErrorResult(result.errorMessage);
  }

  return toCallToolResult({
    ok: true,
    project: { id: input.projectId ?? "", status: "active" },
  });
}
