import { normalizeSubtaskTitle, nextSubtaskPosition } from "@ega/domain";

import type { SubtaskDto } from "@ega/contracts";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedUserId } from "./task-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const SUBTASK_SELECT =
  "id, task_id, title, done, position, completed_at, created_at, updated_at";

function mapRow(row: Tables<"task_subtasks">): SubtaskDto {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    done: row.done,
    position: row.position,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolve(supabase?: SupabaseServerClient) {
  const client = supabase ?? (await createClient());
  const ownerUserId = await getAuthenticatedUserId(client);
  return { client, ownerUserId };
}

export type SubtaskResult<T> = { data: T; errorMessage: null } | { data: null; errorMessage: string };

export async function listTaskSubtasks(
  taskId: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<SubtaskResult<SubtaskDto[]>> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return { data: null, errorMessage: "Task was not found or is no longer available." };

  const { data, error } = await client
    .from("task_subtasks")
    .select(SUBTASK_SELECT)
    .eq("task_id", taskId)
    .eq("owner_user_id", ownerUserId)
    .order("position", { ascending: true });

  if (error) return { data: null, errorMessage: "Unable to load subtasks right now." };
  return { data: (data ?? []).map((row) => mapRow(row as Tables<"task_subtasks">)), errorMessage: null };
}

/** Owner-scoped counts for the list/board chip. */
export async function getSubtaskCountsForTasks(
  taskIds: string[],
  options?: { supabase?: SupabaseServerClient },
): Promise<Record<string, { done: number; total: number }>> {
  if (taskIds.length === 0) return {};
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return {};

  const { data, error } = await client
    .from("task_subtasks")
    .select("task_id, done")
    .in("task_id", taskIds)
    .eq("owner_user_id", ownerUserId);

  if (error) return {};
  const counts: Record<string, { done: number; total: number }> = {};
  for (const row of data ?? []) {
    const entry = counts[row.task_id] ?? { done: 0, total: 0 };
    entry.total += 1;
    if (row.done) entry.done += 1;
    counts[row.task_id] = entry;
  }
  return counts;
}

async function assertTaskOwned(
  client: SupabaseServerClient,
  ownerUserId: string,
  taskId: string,
): Promise<boolean> {
  const { data } = await client
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();
  return Boolean(data);
}

export async function addTaskSubtask(
  input: { taskId: string; title: string },
  options?: { supabase?: SupabaseServerClient },
): Promise<SubtaskResult<SubtaskDto>> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return { data: null, errorMessage: "Task was not found or is no longer available." };
  if (!(await assertTaskOwned(client, ownerUserId, input.taskId))) {
    return { data: null, errorMessage: "Task was not found or is no longer available." };
  }

  const title = normalizeSubtaskTitle(input.title);
  if (!title.ok) return { data: null, errorMessage: title.errorMessage };

  const { data: existing } = await client
    .from("task_subtasks")
    .select("position")
    .eq("task_id", input.taskId)
    .eq("owner_user_id", ownerUserId);

  const position = nextSubtaskPosition((existing ?? []).map((row) => row.position));

  const { data, error } = await client
    .from("task_subtasks")
    .insert({
      task_id: input.taskId,
      owner_user_id: ownerUserId,
      title: title.title,
      position,
    })
    .select(SUBTASK_SELECT)
    .maybeSingle();

  if (error || !data) return { data: null, errorMessage: "Unable to add the subtask right now." };
  return { data: mapRow(data as Tables<"task_subtasks">), errorMessage: null };
}

export async function renameTaskSubtask(
  input: { subtaskId: string; title: string },
  options?: { supabase?: SupabaseServerClient },
): Promise<SubtaskResult<SubtaskDto>> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return { data: null, errorMessage: "Subtask was not found." };

  const title = normalizeSubtaskTitle(input.title);
  if (!title.ok) return { data: null, errorMessage: title.errorMessage };

  const { data, error } = await client
    .from("task_subtasks")
    .update({ title: title.title, updated_at: new Date().toISOString() })
    .eq("id", input.subtaskId)
    .eq("owner_user_id", ownerUserId)
    .select(SUBTASK_SELECT)
    .maybeSingle();

  if (error || !data) return { data: null, errorMessage: "Subtask was not found." };
  return { data: mapRow(data as Tables<"task_subtasks">), errorMessage: null };
}

export async function setTaskSubtaskDone(
  input: { subtaskId: string; done: boolean },
  options?: { supabase?: SupabaseServerClient },
): Promise<SubtaskResult<SubtaskDto>> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return { data: null, errorMessage: "Subtask was not found." };

  const now = new Date().toISOString();
  const { data, error } = await client
    .from("task_subtasks")
    .update({
      done: input.done,
      completed_at: input.done ? now : null,
      updated_at: now,
    })
    .eq("id", input.subtaskId)
    .eq("owner_user_id", ownerUserId)
    .select(SUBTASK_SELECT)
    .maybeSingle();

  if (error || !data) return { data: null, errorMessage: "Subtask was not found." };
  return { data: mapRow(data as Tables<"task_subtasks">), errorMessage: null };
}

export async function deleteTaskSubtask(
  subtaskId: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<{ errorMessage: string | null }> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return { errorMessage: "Subtask was not found." };

  const { error } = await client
    .from("task_subtasks")
    .delete()
    .eq("id", subtaskId)
    .eq("owner_user_id", ownerUserId);

  return { errorMessage: error ? "Unable to delete the subtask right now." : null };
}

/**
 * Move one item one slot up/down and renumber the whole checklist in one
 * bounded sequence. Positions are rewritten densely so order stays stable.
 */
export async function moveTaskSubtask(
  input: { taskId: string; subtaskId: string; direction: "up" | "down" },
  options?: { supabase?: SupabaseServerClient },
): Promise<{ errorMessage: string | null }> {
  const list = await listTaskSubtasks(input.taskId, options);
  if (!list.data) return { errorMessage: list.errorMessage };

  const index = list.data.findIndex((item) => item.id === input.subtaskId);
  if (index === -1) return { errorMessage: "Subtask was not found." };
  const target = input.direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= list.data.length) return { errorMessage: null };

  const reordered = [...list.data];
  const [item] = reordered.splice(index, 1);
  if (!item) return { errorMessage: null };
  reordered.splice(target, 0, item);

  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return { errorMessage: "Subtask was not found." };

  for (const [position, subtask] of reordered.entries()) {
    if (subtask.position === position) continue;
    const { error } = await client
      .from("task_subtasks")
      .update({ position, updated_at: new Date().toISOString() })
      .eq("id", subtask.id)
      .eq("owner_user_id", ownerUserId);
    if (error) return { errorMessage: "Unable to reorder subtasks right now." };
  }

  return { errorMessage: null };
}

/** Atomic promote: create the task and consume the checklist item in one RPC. */
export async function promoteTaskSubtask(
  subtaskId: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<SubtaskResult<{ taskId: string }>> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return { data: null, errorMessage: "Subtask was not found." };

  const newTaskId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const { data, error } = await client.rpc("promote_task_subtask", {
    p_subtask_id: subtaskId,
    p_new_task_id: newTaskId,
  });

  if (error || !data) return { data: null, errorMessage: "Unable to promote the subtask right now." };
  return { data: { taskId: newTaskId }, errorMessage: null };
}
