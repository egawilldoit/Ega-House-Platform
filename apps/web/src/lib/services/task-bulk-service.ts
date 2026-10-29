import { createClient } from "@/lib/supabase/server";
import type { Tables, TablesUpdate } from "@/lib/supabase/database.types";
import {
  archiveTask,
  getAuthenticatedUserId,
  resolveSupabaseClient,
  unarchiveTask,
  updateTaskInline,
  validateTaskInlineUpdateInput,
} from "./task-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export const BULK_TASK_LIMIT = 50;
export const RECEIPT_TTL_MS = 10 * 60 * 1000;

export const BULK_TASK_FIELDS = ["status", "priority", "project"] as const;
export type BulkTaskField = (typeof BULK_TASK_FIELDS)[number];

export type BulkTaskOutcome = {
  taskId: string;
  outcome: "applied" | "ineligible" | "error";
  message: string | null;
};

export type BulkTaskResult = {
  operationId: string | null;
  field: BulkTaskField | "archive" | "restore";
  applied: number;
  results: BulkTaskOutcome[];
  undoable: boolean;
  errorMessage: string | null;
};

type TaskRow = Pick<
  Tables<"tasks">,
  | "id"
  | "status"
  | "priority"
  | "due_date"
  | "estimate_minutes"
  | "blocked_reason"
  | "project_id"
  | "goal_id"
  | "archived_at"
  | "archived_by"
  | "updated_at"
>;

const RECEIPT_COLUMNS = new Set([
  "status",
  "priority",
  "due_date",
  "estimate_minutes",
  "blocked_reason",
  "project_id",
  "goal_id",
  "archived_at",
  "archived_by",
]);

function isBulkField(value: string): value is BulkTaskField {
  return (BULK_TASK_FIELDS as readonly string[]).includes(value);
}

function normalizeIds(rawIds: string[]): string[] {
  return Array.from(new Set(rawIds.map((id) => id.trim()).filter(Boolean))).slice(
    0,
    BULK_TASK_LIMIT,
  );
}

function isDoneTransition(from: string, to: string): boolean {
  const done = (status: string) => ["done", "complete", "completed"].includes(status.toLowerCase());
  return done(from) || done(to);
}

async function readOwnedTask(
  supabase: SupabaseServerClient,
  ownerUserId: string,
  taskId: string,
): Promise<TaskRow | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, status, priority, due_date, estimate_minutes, blocked_reason, project_id, goal_id, archived_at, archived_by, updated_at",
    )
    .eq("id", taskId)
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();

  if (error || !data) return null;
  return data as TaskRow;
}

async function writeReceipt(
  supabase: SupabaseServerClient,
  input: {
    ownerUserId: string;
    operationId: string;
    taskId: string;
    action: "archive" | "restore" | "patch";
    beforeValues: Record<string, string | number | null>;
    afterValues: Record<string, string | number | null>;
  },
): Promise<boolean> {
  const { error } = await supabase.from("task_operation_receipts").insert({
    owner_user_id: input.ownerUserId,
    operation_id: input.operationId,
    task_id: input.taskId,
    action: input.action,
    before_values: input.beforeValues,
    after_values: input.afterValues,
    expires_at: new Date(Date.now() + RECEIPT_TTL_MS).toISOString(),
  });

  return !error;
}

/**
 * Apply one field change to each selected task.
 *
 * Every item is re-read and validated server-side; the update carries the
 * `updated_at` it read, so a concurrent editor produces a conflict rather than
 * a silent overwrite. Items are independent: partial success is reported, never
 * presented as all-or-nothing. Receipts are written only for operations with a
 * safe inverse (ordinary field patches excluding completion transitions).
 */
export async function bulkPatchTasksForOwner(
  input: { taskIds: string[]; field: string; value: string },
  options?: { supabase?: SupabaseServerClient },
): Promise<BulkTaskResult> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const ownerUserId = await getAuthenticatedUserId(supabase);
  const base: BulkTaskResult = {
    operationId: null,
    field: isBulkField(input.field) ? input.field : "status",
    applied: 0,
    results: [],
    undoable: false,
    errorMessage: null,
  };

  if (!ownerUserId) {
    return { ...base, errorMessage: "Task update request is invalid." };
  }
  if (!isBulkField(input.field)) {
    return { ...base, errorMessage: "Unsupported bulk field." };
  }

  const taskIds = normalizeIds(input.taskIds);
  if (taskIds.length === 0) {
    return { ...base, errorMessage: "Select at least one task." };
  }

  const operationId = crypto.randomUUID();
  const results: BulkTaskOutcome[] = [];
  let receiptsWritten = 0;
  let undoEligible = 0;

  for (const taskId of taskIds) {
    const current = await readOwnedTask(supabase, ownerUserId, taskId);
    if (!current) {
      results.push({ taskId, outcome: "ineligible", message: "Task not found or not yours." });
      continue;
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (input.field === "status" && input.value === "blocked" && !current.blocked_reason) {
      results.push({
        taskId,
        outcome: "ineligible",
        message: "A blocked reason is required before marking a task blocked.",
      });
      continue;
    }

    const validation = validateTaskInlineUpdateInput({
      taskId,
      title: undefined,
      projectId: input.field === "project" ? input.value : undefined,
      goalId: input.field === "project" ? "" : undefined,
      status: input.field === "status" ? input.value : current.status,
      priority: input.field === "priority" ? input.value : current.priority,
      dueDate: current.due_date ?? "",
      estimateMinutes: current.estimate_minutes,
      blockedReason: current.blocked_reason,
    });

    if (validation.errorMessage || !validation.data) {
      results.push({
        taskId,
        outcome: "ineligible",
        message: validation.errorMessage ?? "Task update is invalid.",
      });
      continue;
    }

    before.status = current.status;
    before.priority = current.priority;
    before.due_date = current.due_date;
    before.estimate_minutes = current.estimate_minutes;
    before.blocked_reason = current.blocked_reason;
    before.project_id = current.project_id;
    before.goal_id = current.goal_id;

    const { errorMessage } = await updateTaskInline(validation.data, {
      supabase,
      expectedUpdatedAt: current.updated_at,
    });

    if (errorMessage) {
      results.push({ taskId, outcome: "error", message: errorMessage });
      continue;
    }

    after.status = validation.data.status;
    after.priority = validation.data.priority;
    after.due_date = validation.data.dueDate || null;
    after.estimate_minutes = validation.data.estimateMinutes ?? null;
    after.blocked_reason = validation.data.blockedReason ?? null;
    after.project_id = input.field === "project" ? input.value : current.project_id;
    after.goal_id = input.field === "project" ? null : current.goal_id;

    const changedKeys = Object.keys(after).filter(
      (key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]),
    );
    const undoable =
      changedKeys.length > 0 &&
      !(input.field === "status" && isDoneTransition(current.status, input.value));

    if (undoable) {
      undoEligible += 1;
      const written = await writeReceipt(supabase, {
        ownerUserId,
        operationId,
        taskId,
        action: "patch",
        beforeValues: Object.fromEntries(
          changedKeys.map((key) => [key, before[key]]),
        ) as Record<string, string | number | null>,
        afterValues: Object.fromEntries(
          changedKeys.map((key) => [key, after[key]]),
        ) as Record<string, string | number | null>,
      });
      if (written) receiptsWritten += 1;
    }

    results.push({ taskId, outcome: "applied", message: null });
  }

  const applied = results.filter((result) => result.outcome === "applied").length;
  return {
    operationId: receiptsWritten > 0 ? operationId : null,
    field: input.field,
    applied,
    results,
    undoable: undoEligible > 0 && receiptsWritten === undoEligible,
    errorMessage: applied === 0 ? "No selected task could be updated." : null,
  };
}

/** Archive or restore each selected task, reusing the canonical archive policy. */
export async function bulkArchiveTasksForOwner(
  input: { taskIds: string[]; archived: boolean },
  options?: { supabase?: SupabaseServerClient },
): Promise<BulkTaskResult> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const ownerUserId = await getAuthenticatedUserId(supabase);
  const field = input.archived ? "archive" : "restore";
  const base: BulkTaskResult = {
    operationId: null,
    field,
    applied: 0,
    results: [],
    undoable: false,
    errorMessage: null,
  };

  if (!ownerUserId) {
    return { ...base, errorMessage: "Task update request is invalid." };
  }

  const taskIds = normalizeIds(input.taskIds);
  if (taskIds.length === 0) {
    return { ...base, errorMessage: "Select at least one task." };
  }

  const operationId = crypto.randomUUID();
  const results: BulkTaskOutcome[] = [];
  let receiptsWritten = 0;

  for (const taskId of taskIds) {
    const current = await readOwnedTask(supabase, ownerUserId, taskId);
    if (!current) {
      results.push({ taskId, outcome: "ineligible", message: "Task not found or not yours." });
      continue;
    }
    if (input.archived && current.archived_at) {
      results.push({ taskId, outcome: "ineligible", message: "Task is already archived." });
      continue;
    }
    if (!input.archived && !current.archived_at) {
      results.push({ taskId, outcome: "ineligible", message: "Task is not archived." });
      continue;
    }

    const { errorMessage } = input.archived
      ? await archiveTask(taskId, { supabase })
      : await unarchiveTask(taskId, { supabase });

    if (errorMessage) {
      results.push({ taskId, outcome: "error", message: errorMessage });
      continue;
    }

    const written = await writeReceipt(supabase, {
      ownerUserId,
      operationId,
      taskId,
      action: input.archived ? "archive" : "restore",
      beforeValues: { archived_at: current.archived_at, archived_by: current.archived_by },
      afterValues: input.archived
        ? { archived_at: new Date().toISOString(), archived_by: ownerUserId }
        : { archived_at: null, archived_by: null },
    });
    if (written) receiptsWritten += 1;

    results.push({ taskId, outcome: "applied", message: null });
  }

  const applied = results.filter((result) => result.outcome === "applied").length;
  return {
    operationId: receiptsWritten > 0 ? operationId : null,
    field,
    applied,
    results,
    undoable: receiptsWritten > 0 && receiptsWritten === applied,
    errorMessage: applied === 0 ? "No selected task could be updated." : null,
  };
}

export type UndoTaskOutcome = {
  taskId: string;
  outcome: "restored" | "conflict" | "expired" | "missing" | "already_undone";
};

/**
 * Undo one operation from its server receipts.
 *
 * The current row must still match every recorded after-value; otherwise a newer
 * edit wins and the item is reported as a conflict. Only recorded columns are
 * restored, and the receipt is consumed so retries report `already_undone`.
 */
export async function undoTaskOperationForOwner(
  operationId: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<{ results: UndoTaskOutcome[]; errorMessage: string | null }> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const ownerUserId = await getAuthenticatedUserId(supabase);
  if (!ownerUserId || !operationId) {
    return { results: [], errorMessage: "Undo request is invalid." };
  }

  const { data: receipts, error } = await supabase
    .from("task_operation_receipts")
    .select("id, task_id, before_values, after_values, expires_at, undone_at")
    .eq("owner_user_id", ownerUserId)
    .eq("operation_id", operationId);

  if (error) {
    return { results: [], errorMessage: "Unable to load the undo record." };
  }

  const results: UndoTaskOutcome[] = [];
  const now = Date.now();

  for (const receipt of receipts ?? []) {
    if (receipt.undone_at) {
      results.push({ taskId: receipt.task_id, outcome: "already_undone" });
      continue;
    }
    if (new Date(receipt.expires_at).getTime() <= now) {
      results.push({ taskId: receipt.task_id, outcome: "expired" });
      continue;
    }

    const current = await readOwnedTask(supabase, ownerUserId, receipt.task_id);
    if (!current) {
      results.push({ taskId: receipt.task_id, outcome: "missing" });
      continue;
    }

    const afterValues = (receipt.after_values ?? {}) as Record<string, unknown>;
    const currentByColumn: Record<string, unknown> = {
      status: current.status,
      priority: current.priority,
      due_date: current.due_date,
      estimate_minutes: current.estimate_minutes,
      blocked_reason: current.blocked_reason,
      project_id: current.project_id,
      goal_id: current.goal_id,
      archived_at: current.archived_at,
      archived_by: current.archived_by,
    };

    const drifted = Object.entries(afterValues).some(([key, value]) => {
      if (!RECEIPT_COLUMNS.has(key)) return true;
      return JSON.stringify(currentByColumn[key] ?? null) !== JSON.stringify(value ?? null);
    });
    if (drifted) {
      results.push({ taskId: receipt.task_id, outcome: "conflict" });
      continue;
    }

    const beforeValues = (receipt.before_values ?? {}) as Record<
      string,
      string | number | null
    >;
    const update: Record<string, string | number | null> = {
      updated_at: new Date().toISOString(),
    };
    for (const [key, value] of Object.entries(beforeValues)) {
      if (RECEIPT_COLUMNS.has(key)) update[key] = value ?? null;
    }
    const updatePayload = update as TablesUpdate<"tasks">;

    const { data: updated, error: updateError } = await supabase
      .from("tasks")
      .update(updatePayload)
      .eq("id", receipt.task_id)
      .eq("owner_user_id", ownerUserId)
      .eq("updated_at", current.updated_at)
      .select("id")
      .maybeSingle();

    if (updateError || !updated) {
      results.push({ taskId: receipt.task_id, outcome: "conflict" });
      continue;
    }

    await supabase
      .from("task_operation_receipts")
      .update({ undone_at: new Date().toISOString() })
      .eq("id", receipt.id)
      .eq("owner_user_id", ownerUserId)
      .is("undone_at", null);

    results.push({ taskId: receipt.task_id, outcome: "restored" });
  }

  if (results.length === 0) {
    return { results, errorMessage: "This operation can no longer be undone." };
  }

  return { results, errorMessage: null };
}
