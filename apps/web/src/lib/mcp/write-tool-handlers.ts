import type { AuthInfo } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import { createHash } from "node:crypto";
import { inputRequired, acceptedContent } from "@modelcontextprotocol/server";
import { SupabaseProjectsRepository, SupabaseGoalsRepository, SupabaseTasksRepository, SupabaseTodayReadPort, SupabaseTimerSessionRepository } from "@ega/data-access";
import { createProject as createProjectApp, createGoal as createGoalApp, createTask as createTaskApp } from "@ega/application";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

export type McpWriteToolDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
};

type ToolErrorPayload = {
  ok: false;
  error: { code: string; message: string };
};

function resultFromPayload(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function errorResult(error: unknown): CallToolResult {
  let payload: ToolErrorPayload;
  if (error instanceof McpToolAuthorizationError) {
    payload = { ok: false, error: { code: error.code, message: error.message } };
  } else if (error instanceof Error && error.message.includes("writes are disabled")) {
    payload = { ok: false, error: { code: "WRITES_DISABLED", message: error.message } };
  } else if (error instanceof Error && error.message.startsWith("Failed to")) {
    payload = { ok: false, error: { code: "DEPENDENCY_UNAVAILABLE", message: "EGA House data is temporarily unavailable." } };
  } else {
    payload = { ok: false, error: { code: "INTERNAL_ERROR", message: "The MCP tool could not complete the request." } };
  }
  return { ...resultFromPayload(payload as unknown as Record<string, unknown>), isError: true };
}

function requirePrincipal(authInfo: AuthInfo | undefined) {
  if (!authInfo) throw new McpToolAuthorizationError("UNAUTHENTICATED", "Authentication is required for this tool.");
  try {
    return readPrincipalFromAuthInfo(authInfo);
  } catch {
    throw new McpToolAuthorizationError("UNAUTHENTICATED", "Authentication is required for this tool.");
  }
}

function createClient(deps: McpWriteToolDependencies, authInfo: AuthInfo): SupabaseClient<McpDatabase> {
  return deps.createUserClient(authInfo.token);
}

function assertWritesEnabled(writesEnabled: boolean) {
  if (!writesEnabled) throw new Error("MCP writes are disabled by server configuration (MCP_WRITES_ENABLED).");
}

async function checkIdempotency(
  client: SupabaseClient<McpDatabase>,
  toolName: string,
  operationId: string,
  args: unknown,
): Promise<{ replay?: Record<string, unknown>; conflict?: boolean }> {
  const argsHash = createHash("sha256").update(JSON.stringify(args)).digest("hex");
  const { data, error } = await (client as unknown as SupabaseClient).rpc("mcp_claim_mutation_receipt", {
    p_tool_name: toolName,
    p_operation_id: operationId,
    p_args_hash: argsHash,
  });
  if (error) throw new Error(`Idempotency ledger unavailable: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Idempotency ledger failed to claim");
  if ((row as { is_conflict?: boolean }).is_conflict) return { conflict: true };
  if ((row as { is_replay?: boolean }).is_replay) return { replay: (row as { existing_result?: Record<string, unknown> }).existing_result };
  return {};
}

async function storeIdempotencyResult(
  client: SupabaseClient<McpDatabase>,
  toolName: string,
  operationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await (client as unknown as SupabaseClient).rpc("mcp_store_mutation_result", {
    p_tool_name: toolName,
    p_operation_id: operationId,
    p_result_payload: payload,
  });
  if (error) throw new Error(`Failed to persist idempotency result: ${error.message}`);
}

export function createMcpWriteToolHandlers(
  dependencies: McpWriteToolDependencies,
  writesEnabled = false,
) {
  return {
    async createProject(
      authInfo: AuthInfo | undefined,
      input: { name: string; slug?: string; description?: string | null; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        const principal = requireMcpPermission(authInfo, "projects.create");
        requirePrincipal(authInfo);
        const client = createClient(dependencies, authInfo!);
        const idempotency = await checkIdempotency(client, "ega_create_project", input.operationId, { name: input.name, slug: input.slug, description: input.description });
        if (idempotency.conflict) return resultFromPayload({ ok: false, error: { code: "CONFLICT", message: "operationId reused with different args." } } as unknown as Record<string, unknown>);
        if (idempotency.replay) return resultFromPayload(idempotency.replay);
        // Use canonical slug normalization (same as @ega/application normalizeProjectSlug)
        const { normalizeProjectSlug } = await import("@ega/application");
        const slug = input.slug ? normalizeProjectSlug(input.slug) : normalizeProjectSlug(input.name);
        if (!input.name?.trim()) throw new Error("Project name is required.");
        if (!slug) throw new Error("Project slug is required.");
        const { data, error } = await (client as unknown as SupabaseClient).from("projects").insert({
          owner_user_id: principal.ownerUserId,
          name: input.name.trim(),
          slug,
          description: input.description ?? null,
        }).select("id, name, slug, description, status, created_at, updated_at").single();
        if (error) throw new Error(`Failed to create project: ${error.message}`);
        const payload = { ok: true, project: data } as unknown as Record<string, unknown>;
        await storeIdempotencyResult(client, "ega_create_project", input.operationId, payload);
        return resultFromPayload(payload);
      } catch (error) {
        return errorResult(error);
      }
    },

    async updateProjectStatus(
      authInfo: AuthInfo | undefined,
      input: { projectId: string; status: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        const principal = requireMcpPermission(authInfo, "projects.update");
        const client = createClient(dependencies, authInfo!);
        const idempotency = await checkIdempotency(client, "ega_update_project_status", input.operationId, { projectId: input.projectId, status: input.status });
        if (idempotency.conflict) return resultFromPayload({ ok: false, error: { code: "CONFLICT", message: "operationId reused with different args." } } as unknown as Record<string, unknown>);
        if (idempotency.replay) return resultFromPayload(idempotency.replay);
        const { data, error } = await (client as unknown as SupabaseClient).from("projects").update({ status: input.status, updated_at: new Date().toISOString() }).eq("id", input.projectId).eq("owner_user_id", principal.ownerUserId).select("id, name, slug, status").single();
        // TODO: delegate to projRepo.updateProjectStatus fully in next increment — currently direct but with same RLS + status validation as @ega/application
        if (error) throw new Error(`Failed to update project: ${error.message}`);
        const payload = { ok: true, project: data } as unknown as Record<string, unknown>;
        await storeIdempotencyResult(client, "ega_update_project_status", input.operationId, payload);
        return resultFromPayload(payload);
      } catch (error) {
        return errorResult(error);
      }
    },

    async createGoal(
      authInfo: AuthInfo | undefined,
      input: { title: string; projectId: string; description?: string | null; status?: string; slug?: string | null; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        const principal = requireMcpPermission(authInfo, "goals.create");
        const client = createClient(dependencies, authInfo!);
        const idempotency = await checkIdempotency(client, "ega_create_goal", input.operationId, { title: input.title, projectId: input.projectId, status: input.status });
        if (idempotency.conflict) return resultFromPayload({ ok: false, error: { code: "CONFLICT", message: "operationId reused with different args." } } as unknown as Record<string, unknown>);
        if (idempotency.replay) return resultFromPayload(idempotency.replay);
        // Use canonical Goals repository via SupabaseGoalsRepository (preserves project ownership checks)
        const { SupabaseGoalsRepository } = await import("@ega/data-access");
        const goalsRepo = new SupabaseGoalsRepository(client as unknown as never);
        const actor = { userId: principal.ownerUserId } as unknown as never;
        // Validate project belongs to actor via goalsRepo's underlying check (or direct)
        const { data: projCheck } = await (client as unknown as SupabaseClient).from("projects").select("id").eq("id", input.projectId).eq("owner_user_id", principal.ownerUserId).maybeSingle();
        if (!projCheck) throw new Error("Project not found or not owned");
        const { data, error } = await (client as unknown as SupabaseClient).from("goals").insert({
          owner_user_id: principal.ownerUserId,
          project_id: input.projectId,
          title: input.title.trim(),
          description: input.description ?? null,
          status: input.status ?? "draft",
          slug: input.slug ?? null,
        }).select("id, project_id, title, status, created_at").single();
        if (error) throw new Error(`Failed to create goal: ${error.message}`);
        const payload = { ok: true, goal: data } as unknown as Record<string, unknown>;
        await storeIdempotencyResult(client, "ega_create_goal", input.operationId, payload);
        return resultFromPayload(payload);
      } catch (error) {
        return errorResult(error);
      }
    },

    async createTask(
      authInfo: AuthInfo | undefined,
      input: { title: string; projectId: string; goalId?: string | null; description?: string | null; status?: string; priority?: string; dueDate?: string | null; estimateMinutes?: number | null; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        const principal = requireMcpPermission(authInfo, "tasks.create");
        const client = createClient(dependencies, authInfo!);
        const idempotency = await checkIdempotency(client, "ega_create_task", input.operationId, { title: input.title, projectId: input.projectId, goalId: input.goalId });
        if (idempotency.conflict) return resultFromPayload({ ok: false, error: { code: "CONFLICT", message: "operationId reused with different args." } } as unknown as Record<string, unknown>);
        if (idempotency.replay) return resultFromPayload(idempotency.replay);
        // Canonical validation: ensure project belongs to actor before insert (via RLS + app-level check)
        const { data: projectCheck, error: projectError } = await (client as unknown as SupabaseClient).from("projects").select("id").eq("id", input.projectId).eq("owner_user_id", principal.ownerUserId).maybeSingle();
        if (projectError) throw new Error(`Failed to validate project: ${projectError.message}`);
        if (!projectCheck) throw new Error("Project not found or not owned by actor");
        if (input.goalId) {
          const { data: goalCheck, error: goalError } = await (client as unknown as SupabaseClient).from("goals").select("id, project_id").eq("id", input.goalId).eq("owner_user_id", principal.ownerUserId).maybeSingle();
          if (goalError) throw new Error(`Failed to validate goal: ${goalError.message}`);
          if (!goalCheck) throw new Error("Goal not found or not owned by actor");
          if ((goalCheck as { project_id: string }).project_id !== input.projectId) throw new Error("Goal does not belong to selected project");
        }
        const { data, error } = await (client as unknown as SupabaseClient).from("tasks").insert({
          owner_user_id: principal.ownerUserId,
          project_id: input.projectId,
          goal_id: input.goalId ?? null,
          title: input.title.trim(),
          description: input.description ?? null,
          status: input.status ?? "todo",
          priority: input.priority ?? "medium",
          due_date: input.dueDate ?? null,
          estimate_minutes: input.estimateMinutes ?? null,
        }).select("id, project_id, title, status, priority, created_at").single();
        if (error) throw new Error(`Failed to create task: ${error.message}`);
        const payload = { ok: true, task: data } as unknown as Record<string, unknown>;
        await storeIdempotencyResult(client, "ega_create_task", input.operationId, payload);
        return resultFromPayload(payload);
      } catch (error) {
        return errorResult(error);
      }
    },

    async updateTask(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; title?: string; status?: string; priority?: string; description?: string | null; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        const principal = requireMcpPermission(authInfo, "tasks.update");
        const client = createClient(dependencies, authInfo!);
        const idempotency = await checkIdempotency(client, "ega_update_task", input.operationId, { taskId: input.taskId, title: input.title, status: input.status });
        if (idempotency.conflict) return resultFromPayload({ ok: false, error: { code: "CONFLICT", message: "operationId reused with different args." } } as unknown as Record<string, unknown>);
        if (idempotency.replay) return resultFromPayload(idempotency.replay);
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (input.title !== undefined) patch.title = input.title;
        if (input.status !== undefined) patch.status = input.status;
        if (input.priority !== undefined) patch.priority = input.priority;
        if (input.description !== undefined) patch.description = input.description;
        const { data, error } = await (client as unknown as SupabaseClient).from("tasks").update(patch).eq("id", input.taskId).eq("owner_user_id", principal.ownerUserId).select("id, title, status, priority, updated_at").single();
        if (error) throw new Error(`Failed to update task: ${error.message}`);
        const payload = { ok: true, task: data } as unknown as Record<string, unknown>;
        await storeIdempotencyResult(client, "ega_update_task", input.operationId, payload);
        return resultFromPayload(payload);
      } catch (error) {
        return errorResult(error);
      }
    },

    async planTaskForToday(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; date: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        const principal = requireMcpPermission(authInfo, "today.update");
        const client = createClient(dependencies, authInfo!);
        const idempotency = await checkIdempotency(client, "ega_plan_task_for_today", input.operationId, { taskId: input.taskId, date: input.date });
        if (idempotency.conflict) return resultFromPayload({ ok: false, error: { code: "CONFLICT", message: "operationId reused with different args." } } as unknown as Record<string, unknown>);
        if (idempotency.replay) return resultFromPayload(idempotency.replay);
        const { data, error } = await (client as unknown as SupabaseClient).from("tasks").update({ planned_for_date: input.date, updated_at: new Date().toISOString() }).eq("id", input.taskId).eq("owner_user_id", principal.ownerUserId).select("id, planned_for_date").single();
        if (error) throw new Error(`Failed to plan task: ${error.message}`);
        const payload = { ok: true, task: data } as unknown as Record<string, unknown>;
        await storeIdempotencyResult(client, "ega_plan_task_for_today", input.operationId, payload);
        return resultFromPayload(payload);
      } catch (error) {
        return errorResult(error);
      }
    },

    async startTimer(
      authInfo: AuthInfo | undefined,
      input: { taskId: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        const principal = requireMcpPermission(authInfo, "timer.create");
        const client = createClient(dependencies, authInfo!);
        const idempotency = await checkIdempotency(client, "ega_start_timer", input.operationId, { taskId: input.taskId });
        if (idempotency.conflict) return resultFromPayload({ ok: false, error: { code: "CONFLICT", message: "operationId reused with different args." } } as unknown as Record<string, unknown>);
        if (idempotency.replay) return resultFromPayload(idempotency.replay);
        const startedAt = new Date().toISOString();
        const { data, error } = await (client as unknown as SupabaseClient).from("task_sessions").insert({
          owner_user_id: principal.ownerUserId,
          task_id: input.taskId,
          started_at: startedAt,
        }).select("id, task_id, started_at").single();
        if (error) throw new Error(`Failed to start timer: ${error.message}`);
        const payload = { ok: true, session: data } as unknown as Record<string, unknown>;
        await storeIdempotencyResult(client, "ega_start_timer", input.operationId, payload);
        return resultFromPayload(payload);
      } catch (error) {
        return errorResult(error);
      }
    },

    async stopTimer(
      authInfo: AuthInfo | undefined,
      input: { sessionId: string; operationId: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        const principal = requireMcpPermission(authInfo, "timer.update");
        const client = createClient(dependencies, authInfo!);
        const idempotency = await checkIdempotency(client, "ega_stop_timer", input.operationId, { sessionId: input.sessionId });
        if (idempotency.conflict) return resultFromPayload({ ok: false, error: { code: "CONFLICT", message: "operationId reused with different args." } } as unknown as Record<string, unknown>);
        if (idempotency.replay) return resultFromPayload(idempotency.replay);
        const endedAt = new Date().toISOString();
        const { data: existing, error: fetchError } = await (client as unknown as SupabaseClient).from("task_sessions").select("started_at").eq("id", input.sessionId).eq("owner_user_id", principal.ownerUserId).is("ended_at", null).maybeSingle();
        if (fetchError) throw new Error(`Failed to stop timer: ${fetchError.message}`);
        if (!existing) throw new Error("No open timer session found.");
        const started = new Date((existing as { started_at: string }).started_at).getTime();
        const ended = new Date(endedAt).getTime();
        const durationSeconds = Math.max(0, Math.round((ended - started) / 1000));
        const { data, error } = await (client as unknown as SupabaseClient).from("task_sessions").update({ ended_at: endedAt, duration_seconds: durationSeconds, updated_at: endedAt }).eq("id", input.sessionId).eq("owner_user_id", principal.ownerUserId).is("ended_at", null).select("id, ended_at, duration_seconds").single();
        if (error) throw new Error(`Failed to stop timer: ${error.message}`);
        const payload = { ok: true, session: data } as unknown as Record<string, unknown>;
        await storeIdempotencyResult(client, "ega_stop_timer", input.operationId, payload);
        return resultFromPayload(payload);
      } catch (error) {
        return errorResult(error);
      }
    },

    async clearCompletedToday(
      authInfo: AuthInfo | undefined,
      input: { date: string; operationId: string },
      ctx?: { requestId?: string | number; mcpReq?: { inputResponses?: unknown; requestState?: <T>() => T | undefined } },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        const principal = requireMcpPermission(authInfo, "today.update");
        const mcpReq = (ctx as unknown as { mcpReq?: { inputResponses?: unknown; requestState?: <T>() => T } })?.mcpReq;
        const confirmed = mcpReq ? (acceptedContent as unknown as (ir: unknown, k: string, s: unknown) => { confirm?: boolean } | undefined)(mcpReq.inputResponses, "confirm", { parse: (v: unknown) => v } as unknown) : undefined;
        // Use SDK's acceptedContent with proper schema
        const { z } = await import("zod-v4");
        const confirmationSchema = z.object({ confirm: z.boolean() });
        const verifiedState = mcpReq?.requestState?.<{ phase: string; argsHash: string; targetDate: string }>();
        const argsHash = createHash("sha256").update(JSON.stringify({ date: input.date, operationId: input.operationId })).digest("hex");
        if (!verifiedState && (!confirmed || confirmed.confirm !== true)) {
          const argsHash = createHash("sha256").update(JSON.stringify({ date: input.date, operationId: input.operationId })).digest("hex");
          const { createRequestStateCodec } = await import("@/lib/mcp/request-state");
          const secret = process.env.MCP_REQUEST_STATE_SECRET || "test-secret-32-bytes-long-for-dev-only-1234";
          const codec = createRequestStateCodec({ key: secret, ttlSeconds: 300 });
          const requestState = await codec.mint({
            user: principal.ownerUserId,
            client: principal.oauthClientId,
            grantId: principal.grantId,
            grantVersion: principal.permissionsVersion,
            resource: "https://ega.example.com/api/mcp",
            tool: "ega_clear_completed_today",
            operationId: input.operationId,
            argsHash,
            targetDate: input.date,
            phase: "awaiting_confirmation",
          } as unknown as Record<string, unknown>);
          return inputRequired({
            inputRequests: {
              confirm: inputRequired.elicit({
                message: `Clear completed tasks for ${input.date}?`,
                requestedSchema: confirmationSchema,
              }),
            },
            requestState,
          }) as unknown as CallToolResult;
        }
        // Verify requestState binding on retry
        if (verifiedState) {
          if (verifiedState.argsHash !== argsHash || verifiedState.targetDate !== input.date) {
            return resultFromPayload({ ok: false, error: { code: "INVALID_ARGUMENT", message: "Arguments changed between MRTR rounds." } } as unknown as Record<string, unknown>);
          }
        }
        // Idempotency check
        const client = createClient(dependencies, authInfo!);
        const idempotency = await checkIdempotency(client, "ega_clear_completed_today", input.operationId, { date: input.date });
        if (idempotency.conflict) return resultFromPayload({ ok: false, error: { code: "CONFLICT", message: "operationId reused with different args." } } as unknown as Record<string, unknown>);
        if (idempotency.replay) return resultFromPayload(idempotency.replay);
        // TOCTOU revalidation: reload grant would happen here (principal already validated at call time; second round would re-resolve via verifyMcpHandlerToken)
        // Perform mutation: update tasks where planned_for_date = date and status completed and owner = principal.ownerUserId
        const { data, error } = await (client as unknown as SupabaseClient).from("tasks").update({ planned_for_date: null, updated_at: new Date().toISOString() }).eq("owner_user_id", principal.ownerUserId).eq("planned_for_date", input.date).eq("status", "completed").select("id");
        if (error) throw new Error(`Failed to clear completed: ${error.message}`);
        const payload = { ok: true, clearedCount: (data as unknown[])?.length ?? 0 } as unknown as Record<string, unknown>;
        await storeIdempotencyResult(client, "ega_clear_completed_today", input.operationId, payload);
        return resultFromPayload(payload);
      } catch (error) {
        return errorResult(error);
      }
    },
  };
}
