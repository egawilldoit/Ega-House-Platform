import type { AuthInfo } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import { hasMcpPermission } from "@/lib/mcp/permissions";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

// Thin bridge showing canonical delegation; actual use replaces direct Supabase inserts
// with @ega/application services + @ega/data-access adapters to keep workflow authority single-sourced.

export type ApplicationBridgeDeps = {
  createUserClient: (token: string) => SupabaseClient<McpDatabase>;
};

export async function createTaskViaApplication(
  authInfo: AuthInfo,
  deps: ApplicationBridgeDeps,
  input: { title: string; projectId: string; goalId?: string | null },
): Promise<{ ok: true; task: unknown }> {
  const principal = readPrincipalFromAuthInfo(authInfo);
  if (!hasMcpPermission(principal.permissions, "tasks.create")) {
    throw new Error("PERMISSION_DENIED");
  }
  // In full implementation:
  // const actor = { userId: principal.ownerUserId } satisfies AuthenticatedActor
  // const repo = new SupabaseTasksRepository(deps.createUserClient(authInfo.token))
  // return await createTask(actor, repo, input)
  // For this increment, we delegate to the same Supabase RLS path but through the bridge
  // to prove the thin-transport pattern; the next iteration swaps to the service.
  const client = deps.createUserClient(authInfo.token);
  const { data, error } = await (client as unknown as SupabaseClient).from("tasks").insert({
    owner_user_id: principal.ownerUserId,
    project_id: input.projectId,
    goal_id: input.goalId ?? null,
    title: input.title,
  }).select("id, title").single();
  if (error) throw new Error(`Failed to create task: ${error.message}`);
  return { ok: true, task: data };
}
