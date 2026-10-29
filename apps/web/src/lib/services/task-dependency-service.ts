import { wouldCreateTaskDependencyCycle, type TaskDependencyEdge } from "@ega/domain";

import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type TaskDependencyRef = Readonly<{
  id: string;
  title: string | null;
  status: string | null;
  startDate: string | null;
  dueDate: string | null;
}>;

export type TaskDependencyDetail = Readonly<{
  blockedBy: TaskDependencyRef[];
  blocking: TaskDependencyRef[];
  /** Owner tasks that may be chosen as a predecessor, excluding self/existing. */
  options: Array<{ id: string; title: string }>;
}>;

export type TaskDependencyMutationResult = Readonly<{
  errorMessage: string | null;
  successMessage?: string | null;
}>;

const DEPENDENCY_EDGE_CAP = 5000;
const DEPENDENCY_OPTION_CAP = 200;

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  return supabase ?? (await createClient());
}

async function getAuthenticatedUserId(supabase: SupabaseServerClient) {
  if (!("auth" in supabase) || typeof supabase.auth?.getUser !== "function") {
    return null;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

function unavailableTask(id: string): TaskDependencyRef {
  return { id, title: null, status: null, startDate: null, dueDate: null };
}

function mapDependencyError(error: { code?: string | null; message?: string | null } | null) {
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("cycle")) {
    return "That dependency would create a cycle.";
  }
  if (message.includes("itself") || message.includes("self")) {
    return "A task cannot be blocked by itself.";
  }
  if (
    message.includes("belong to the edge owner") ||
    error?.code === "42501" ||
    error?.code === "23503"
  ) {
    return "Selected task is unavailable.";
  }
  return "Unable to update task dependencies right now.";
}

/**
 * Owner-scoped dependency detail for the task drawer.
 *
 * `blockedBy` is the editable "Blocked by" list; `blocking` is read-only.
 * References to rows the caller cannot see stay id-only and render as
 * unavailable instead of disclosing another owner's task title.
 */
export async function getTaskDependencyDetail(
  taskId: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<{ data: TaskDependencyDetail | null; errorMessage: string | null }> {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) return { data: null, errorMessage: "Task is required." };

  const supabase = await resolveSupabaseClient(options?.supabase);
  const userId = await getAuthenticatedUserId(supabase);
  if (!userId) return { data: null, errorMessage: "Task was not found or is no longer available." };

  const taskResult = await supabase
    .from("tasks")
    .select("id")
    .eq("id", normalizedTaskId)
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (taskResult.error) return { data: null, errorMessage: "Unable to load task right now." };
  if (!taskResult.data) {
    return { data: null, errorMessage: "Task was not found or is no longer available." };
  }

  const [edgesResult, optionsResult] = await Promise.all([
    supabase
      .from("task_dependencies")
      .select("task_id,blocked_by_task_id")
      .eq("owner_user_id", userId)
      .or(`task_id.eq.${normalizedTaskId},blocked_by_task_id.eq.${normalizedTaskId}`)
      .limit(DEPENDENCY_EDGE_CAP),
    supabase
      .from("tasks")
      .select("id,title")
      .eq("owner_user_id", userId)
      .is("archived_at", null)
      .neq("id", normalizedTaskId)
      .order("title", { ascending: true })
      .limit(DEPENDENCY_OPTION_CAP),
  ]);

  if (edgesResult.error) return { data: null, errorMessage: "Unable to load task dependencies right now." };
  if (optionsResult.error) return { data: null, errorMessage: "Unable to load task options right now." };

  const blockedByIds = new Set<string>();
  const blockingIds = new Set<string>();
  for (const row of edgesResult.data ?? []) {
    const dependentId = String(row.task_id);
    const predecessorId = String(row.blocked_by_task_id);
    if (dependentId === normalizedTaskId) blockedByIds.add(predecessorId);
    if (predecessorId === normalizedTaskId) blockingIds.add(dependentId);
  }

  const relatedIds = [...new Set([...blockedByIds, ...blockingIds])];
  let relatedRows: Array<{
    id: string;
    title: string;
    status: string;
    start_date: string | null;
    due_date: string | null;
  }> = [];
  if (relatedIds.length > 0) {
    const relatedResult = await supabase
      .from("tasks")
      .select("id,title,status,start_date,due_date")
      .eq("owner_user_id", userId)
      .in("id", relatedIds);
    if (relatedResult.error) {
      return { data: null, errorMessage: "Unable to load task dependencies right now." };
    }
    relatedRows = relatedResult.data ?? [];
  }

  const relatedById = new Map(
    relatedRows.map((row) => [
      String(row.id),
      {
        id: String(row.id),
        title: String(row.title),
        status: String(row.status),
        startDate: row.start_date ? String(row.start_date) : null,
        dueDate: row.due_date ? String(row.due_date) : null,
      } satisfies TaskDependencyRef,
    ]),
  );

  const optionItems = (optionsResult.data ?? [])
    .map((row) => ({ id: String(row.id), title: String(row.title) }))
    .filter((option) => !blockedByIds.has(option.id));

  return {
    data: {
      blockedBy: [...blockedByIds].map((id) => relatedById.get(id) ?? unavailableTask(id)),
      blocking: [...blockingIds].map((id) => relatedById.get(id) ?? unavailableTask(id)),
      options: optionItems,
    },
    errorMessage: null,
  };
}

/**
 * Add one "blocked by" edge for a task the caller owns.
 *
 * Ownership is derived from the verified session, never from the submitted
 * form. The domain precheck returns a fast, friendly cycle error; the database
 * trigger remains the durable invariant and is what makes concurrent reverse
 * inserts safe.
 */
export async function addTaskDependency(
  input: { taskId: string; blockedByTaskId: string },
  options?: { supabase?: SupabaseServerClient },
): Promise<TaskDependencyMutationResult> {
  const taskId = input.taskId.trim();
  const blockedByTaskId = input.blockedByTaskId.trim();

  if (!taskId || !blockedByTaskId) {
    return { errorMessage: "Task dependency request is invalid." };
  }
  if (taskId === blockedByTaskId) {
    return { errorMessage: "A task cannot be blocked by itself." };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const userId = await getAuthenticatedUserId(supabase);
  if (!userId) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  const endpointResult = await supabase
    .from("tasks")
    .select("id")
    .eq("owner_user_id", userId)
    .in("id", [taskId, blockedByTaskId]);
  if (endpointResult.error) {
    return { errorMessage: "Unable to validate task dependencies right now." };
  }
  const ownedEndpointIds = new Set((endpointResult.data ?? []).map((row) => String(row.id)));
  if (!ownedEndpointIds.has(taskId) || !ownedEndpointIds.has(blockedByTaskId)) {
    return { errorMessage: "Selected task is unavailable." };
  }

  const edgesResult = await supabase
    .from("task_dependencies")
    .select("task_id,blocked_by_task_id")
    .eq("owner_user_id", userId)
    .limit(DEPENDENCY_EDGE_CAP);
  if (edgesResult.error) {
    return { errorMessage: "Unable to validate task dependencies right now." };
  }

  const existingEdges: TaskDependencyEdge[] = (edgesResult.data ?? []).map((row) => ({
    taskId: String(row.task_id),
    blockedByTaskId: String(row.blocked_by_task_id),
  }));
  if (
    existingEdges.some(
      (edge) => edge.taskId === taskId && edge.blockedByTaskId === blockedByTaskId,
    )
  ) {
    return { errorMessage: "That dependency already exists." };
  }
  if (wouldCreateTaskDependencyCycle(existingEdges, { taskId, blockedByTaskId })) {
    return { errorMessage: "That dependency would create a cycle." };
  }

  const insertResult = await supabase.from("task_dependencies").insert({
    owner_user_id: userId,
    task_id: taskId,
    blocked_by_task_id: blockedByTaskId,
  });
  if (insertResult.error) {
    if (insertResult.error.code === "23505") {
      return { errorMessage: "That dependency already exists." };
    }
    return { errorMessage: mapDependencyError(insertResult.error) };
  }

  return { errorMessage: null, successMessage: "Dependency added." };
}

export async function removeTaskDependency(
  input: { taskId: string; blockedByTaskId: string },
  options?: { supabase?: SupabaseServerClient },
): Promise<TaskDependencyMutationResult> {
  const taskId = input.taskId.trim();
  const blockedByTaskId = input.blockedByTaskId.trim();
  if (!taskId || !blockedByTaskId) {
    return { errorMessage: "Task dependency request is invalid." };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const userId = await getAuthenticatedUserId(supabase);
  if (!userId) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  const deleteResult = await supabase
    .from("task_dependencies")
    .delete()
    .eq("owner_user_id", userId)
    .eq("task_id", taskId)
    .eq("blocked_by_task_id", blockedByTaskId);
  if (deleteResult.error) {
    return { errorMessage: "Unable to remove the dependency right now." };
  }

  return { errorMessage: null, successMessage: "Dependency removed." };
}
