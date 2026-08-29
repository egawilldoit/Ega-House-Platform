import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";

import { GOAL_ARCHIVE_STATUS } from "@ega/domain";
import {
  archiveGoal as archiveGoalInApplication,
  createGoal as createGoalInApplication,
  unarchiveGoal as unarchiveGoalInApplication,
  updateGoalHealth as updateGoalHealthInApplication,
  updateGoalNextStep as updateGoalNextStepInApplication,
  updateGoalStatus as updateGoalStatusInApplication,
  type AuthenticatedActor,
} from "@ega/application";
import { SupabaseGoalsRepository } from "@ega/data-access";

import type { McpWriteModuleDeps } from "@/lib/mcp/write/projects";
import { requireMcpPermission } from "@/lib/mcp/tool-authorization";

export type { McpWriteModuleDeps };

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
  permission: "goals.create" | "goals.update",
): AuthenticatedActor {
  const principal = requireMcpPermission(authInfo, permission);
  return { userId: principal.ownerUserId };
}

function createRepository(deps: McpWriteModuleDeps, authInfo: AuthInfo) {
  return new SupabaseGoalsRepository(deps.createUserClient(authInfo.token));
}

export async function createGoal(
  authInfo: AuthInfo | undefined,
  input: {
    title?: string;
    projectId?: string;
    description?: string | null;
    nextStep?: string | null;
    health?: string | null;
    status?: string;
    slug?: string | null;
    operationId?: string;
  },
  deps: McpWriteModuleDeps,
): Promise<CallToolResult> {
  const principal = requireMcpPermission(authInfo, "goals.create");
  const actor: AuthenticatedActor = { userId: principal.ownerUserId };
  const repository = createRepository(deps, authInfo!);

  const result = await createGoalInApplication(actor, repository, {
    title: input.title,
    projectId: input.projectId,
    description: input.description,
    nextStep: input.nextStep,
    health: input.health,
    status: input.status,
    slug: input.slug,
    ...(input.operationId
      ? { mcpOperationId: input.operationId, mcpClientId: principal.oauthClientId }
      : {}),
  });

  if (!result.ok) {
    return applicationErrorResult(result.errorMessage);
  }

  return toCallToolResult({ ok: true, goal: result.data ?? result.values });
}

export async function updateGoalStatus(
  authInfo: AuthInfo | undefined,
  input: { goalId?: string; status?: string },
  deps: McpWriteModuleDeps,
): Promise<CallToolResult> {
  const actor = resolveActor(authInfo, "goals.update");
  const repository = createRepository(deps, authInfo!);

  const result = await updateGoalStatusInApplication(actor, repository, {
    goalId: input.goalId,
    status: input.status,
  });

  if (!result.ok) {
    return applicationErrorResult(result.errorMessage);
  }

  return toCallToolResult({
    ok: true,
    goal: { id: input.goalId ?? "", status: input.status ?? "" },
  });
}

export async function updateGoalHealth(
  authInfo: AuthInfo | undefined,
  input: { goalId?: string; health?: string | null },
  deps: McpWriteModuleDeps,
): Promise<CallToolResult> {
  const actor = resolveActor(authInfo, "goals.update");
  const repository = createRepository(deps, authInfo!);

  const result = await updateGoalHealthInApplication(actor, repository, {
    goalId: input.goalId,
    health: input.health,
  });

  if (!result.ok) {
    return applicationErrorResult(result.errorMessage);
  }

  return toCallToolResult({ ok: true, goal: { id: input.goalId ?? "" } });
}

export async function updateGoalNextStep(
  authInfo: AuthInfo | undefined,
  input: { goalId?: string; nextStep?: string | null },
  deps: McpWriteModuleDeps,
): Promise<CallToolResult> {
  const actor = resolveActor(authInfo, "goals.update");
  const repository = createRepository(deps, authInfo!);

  const result = await updateGoalNextStepInApplication(actor, repository, {
    goalId: input.goalId,
    nextStep: input.nextStep,
  });

  if (!result.ok) {
    return applicationErrorResult(result.errorMessage);
  }

  return toCallToolResult({ ok: true, goal: { id: input.goalId ?? "" } });
}

export async function archiveGoal(
  authInfo: AuthInfo | undefined,
  input: { goalId?: string },
  deps: McpWriteModuleDeps,
): Promise<CallToolResult> {
  const actor = resolveActor(authInfo, "goals.update");
  const repository = createRepository(deps, authInfo!);

  const result = await archiveGoalInApplication(actor, repository, {
    goalId: input.goalId,
  });

  if (!result.ok) {
    return applicationErrorResult(result.errorMessage);
  }

  return toCallToolResult({
    ok: true,
    goal: { id: input.goalId ?? "", status: GOAL_ARCHIVE_STATUS },
  });
}

export async function unarchiveGoal(
  authInfo: AuthInfo | undefined,
  input: { goalId?: string },
  deps: McpWriteModuleDeps,
): Promise<CallToolResult> {
  const actor = resolveActor(authInfo, "goals.update");
  const repository = createRepository(deps, authInfo!);

  const result = await unarchiveGoalInApplication(actor, repository, {
    goalId: input.goalId,
  });

  if (!result.ok) {
    return applicationErrorResult(result.errorMessage);
  }

  return toCallToolResult({
    ok: true,
    goal: { id: input.goalId ?? "", status: "active" },
  });
}
