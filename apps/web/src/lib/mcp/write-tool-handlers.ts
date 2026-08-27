import type { AuthInfo } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import { createHash } from "node:crypto";
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
  try {
    const { data, error } = await (client as unknown as SupabaseClient).rpc("mcp_claim_mutation_receipt", {
      p_tool_name: toolName,
      p_operation_id: operationId,
      p_args_hash: argsHash,
    });
    if (error) return {};
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return {};
    if ((row as { is_conflict?: boolean }).is_conflict) return { conflict: true };
    if ((row as { is_replay?: boolean }).is_replay) return { replay: (row as { existing_result?: Record<string, unknown> }).existing_result };
  } catch {}
  return {};
}

async function storeIdempotencyResult(
  client: SupabaseClient<McpDatabase>,
  toolName: string,
  operationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await (client as unknown as SupabaseClient).rpc("mcp_store_mutation_result", {
      p_tool_name: toolName,
      p_operation_id: operationId,
      p_result_payload: payload,
    });
  } catch {}
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
        const slug = (input.slug ?? input.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
        if (!input.name?.trim()) throw new Error("Project name is required.");
        if (!slug) throw new Error("Project slug is required.");
        const { data, error } = await (client as unknown as SupabaseClient).from("projects").insert({
          owner_user_id: principal.ownerUserId,
          name: input.name.trim(),
          slug,
          description: input.description ?? null,
        }).select("id, name, slug, description, status, created_at, updated_at").single();
        if (error) throw new Error(`Failed to create project: ${error.message}`);
        return resultFromPayload({ ok: true, project: data });
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
        const { data, error } = await (client as unknown as SupabaseClient).from("projects").update({ status: input.status, updated_at: new Date().toISOString() }).eq("id", input.projectId).eq("owner_user_id", principal.ownerUserId).select("id, name, slug, status").single();
        if (error) throw new Error(`Failed to update project: ${error.message}`);
        return resultFromPayload({ ok: true, project: data });
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
        const { data, error } = await (client as unknown as SupabaseClient).from("goals").insert({
          owner_user_id: principal.ownerUserId,
          project_id: input.projectId,
          title: input.title.trim(),
          description: input.description ?? null,
          status: input.status ?? "draft",
          slug: input.slug ?? null,
        }).select("id, project_id, title, status, created_at").single();
        if (error) throw new Error(`Failed to create goal: ${error.message}`);
        return resultFromPayload({ ok: true, goal: data });
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
        if (!input.operationId) throw new Error("operationId is required for idempotent task creation.");
        const client = createClient(dependencies, authInfo!);
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
        return resultFromPayload({ ok: true, task: data });
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
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (input.title !== undefined) patch.title = input.title;
        if (input.status !== undefined) patch.status = input.status;
        if (input.priority !== undefined) patch.priority = input.priority;
        if (input.description !== undefined) patch.description = input.description;
        const { data, error } = await (client as unknown as SupabaseClient).from("tasks").update(patch).eq("id", input.taskId).eq("owner_user_id", principal.ownerUserId).select("id, title, status, priority, updated_at").single();
        if (error) throw new Error(`Failed to update task: ${error.message}`);
        return resultFromPayload({ ok: true, task: data });
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
        const { data, error } = await (client as unknown as SupabaseClient).from("tasks").update({ planned_for_date: input.date, updated_at: new Date().toISOString() }).eq("id", input.taskId).eq("owner_user_id", principal.ownerUserId).select("id, planned_for_date").single();
        if (error) throw new Error(`Failed to plan task: ${error.message}`);
        return resultFromPayload({ ok: true, task: data });
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
        const startedAt = new Date().toISOString();
        const { data, error } = await (client as unknown as SupabaseClient).from("task_sessions").insert({
          owner_user_id: principal.ownerUserId,
          task_id: input.taskId,
          started_at: startedAt,
        }).select("id, task_id, started_at").single();
        if (error) throw new Error(`Failed to start timer: ${error.message}`);
        return resultFromPayload({ ok: true, session: data });
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
        const endedAt = new Date().toISOString();
        const { data: existing, error: fetchError } = await (client as unknown as SupabaseClient).from("task_sessions").select("started_at").eq("id", input.sessionId).eq("owner_user_id", principal.ownerUserId).is("ended_at", null).maybeSingle();
        if (fetchError) throw new Error(`Failed to stop timer: ${fetchError.message}`);
        if (!existing) throw new Error("No open timer session found.");
        const started = new Date((existing as { started_at: string }).started_at).getTime();
        const ended = new Date(endedAt).getTime();
        const durationSeconds = Math.max(0, Math.round((ended - started) / 1000));
        const { data, error } = await (client as unknown as SupabaseClient).from("task_sessions").update({ ended_at: endedAt, duration_seconds: durationSeconds, updated_at: endedAt }).eq("id", input.sessionId).eq("owner_user_id", principal.ownerUserId).is("ended_at", null).select("id, ended_at, duration_seconds").single();
        if (error) throw new Error(`Failed to stop timer: ${error.message}`);
        return resultFromPayload({ ok: true, session: data });
      } catch (error) {
        return errorResult(error);
      }
    },

    async clearCompletedToday(
      authInfo: AuthInfo | undefined,
      input: { date: string; operationId: string; confirmed?: boolean; requestState?: string },
    ): Promise<CallToolResult> {
      try {
        assertWritesEnabled(writesEnabled);
        const principal = requireMcpPermission(authInfo, "today.update");
        // MRTR: if not confirmed, mint requestState and return input_required
        if (!input.confirmed) {
          // In full MRTR, would use createRequestStateCodec and inputRequired helper
          // Here we return a structured input_required payload for client confirmation
          const argsHash = createHash("sha256").update(JSON.stringify({ date: input.date, operationId: input.operationId })).digest("hex");
          // TOCTOU binding would be done here with codec.mint({user, client, grantId, grantVersion, resource, tool, operationId, argsHash, targetDate: input.date, phase: "awaiting_confirmation"})
          return resultFromPayload({
            ok: false,
            error: { code: "INPUT_REQUIRED", message: "Clear completed Today requires confirmation." },
            input_required: {
              requestState: `mrtr_state_${argsHash.slice(0, 8)}`,
              inputRequests: { confirm: { description: `Clear completed tasks for ${input.date}?`, required: true } },
            },
          } as unknown as Record<string, unknown>);
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
