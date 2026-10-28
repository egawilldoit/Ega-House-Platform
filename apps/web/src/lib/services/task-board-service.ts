import {
  BoardRankError,
  generateBoardRankBetween,
  isBoardRank,
  isTaskStatus,
  isTaskStatusTransitionAllowed,
  type TaskStatus,
} from "@ega/domain";

import { createClient } from "@/lib/supabase/server";
import {
  getAuthenticatedUserId,
  resolveSupabaseClient,
  updateTaskInline,
  validateTaskInlineUpdateInput,
} from "@/lib/services/task-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type BoardColumnEntry = {
  id: string;
  board_rank: string | null;
};

export type BoardMoveConflictCode =
  | "invalid"
  | "not_found"
  | "conflict"
  | "blocked_reason_required"
  | "forbidden_transition";

export type BoardMoveResult =
  | {
      ok: true;
      taskId: string;
      status: TaskStatus;
      boardRank: string | null;
    }
  | {
      ok: false;
      code: BoardMoveConflictCode;
      message: string;
      /** A neighbour/version changed; the client may retry on fresh data. */
      retryable: boolean;
    };

export type MoveTaskOnBoardInput = {
  taskId: string;
  toStatus: string;
  /** Visible card immediately above the insertion point, if any. */
  beforeTaskId?: string | null;
  /** Visible card immediately below the insertion point, if any. */
  afterTaskId?: string | null;
  /**
   * Ranks the client rendered for those neighbours. A mismatch means the
   * column changed underneath this move, so the write is refused instead of
   * guessing a position.
   */
  expectedBeforeRank?: string | null;
  expectedAfterRank?: string | null;
  /** `updated_at` of the moved card when the drag started. */
  expectedUpdatedAt?: string | null;
  blockedReason?: string | null;
};

const MOVE_CONFLICT_MESSAGE =
  "This board changed while you were moving the card. Reload and try again.";

function fail(
  code: BoardMoveConflictCode,
  message: string,
  retryable = false,
): BoardMoveResult {
  return { ok: false, code, message, retryable };
}

function normalizeId(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeOptionalId(value: unknown): string | null {
  const normalized = normalizeId(value);
  return normalized || null;
}

function normalizeOptionalRank(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value);
  return isBoardRank(normalized) ? normalized : undefined;
}

/**
 * Pure insertion planner.
 *
 * `column` is the canonical order of the target status column (already
 * `(board_rank, id)` ordered) with the moved card removed. The requested
 * before/after ids are the visible neighbours in the caller's filtered view;
 * they need not be adjacent in the canonical column because a filter can hide
 * rows between them.
 *
 * Returns `boardRank: null` when the card belongs at the very end of an
 * (empty or fully ranked) column: the database trigger appends the canonical
 * timestamp-shaped key, so the app never invents a key outside its neighbours.
 */
export function planBoardMove(input: {
  column: BoardColumnEntry[];
  beforeTaskId: string | null;
  afterTaskId: string | null;
  expectedBeforeRank: string | null;
  expectedAfterRank: string | null;
}): { ok: true; boardRank: string | null } | { ok: false; message: string } {
  const { column, beforeTaskId, afterTaskId } = input;
  const beforeIndex = beforeTaskId
    ? column.findIndex((entry) => entry.id === beforeTaskId)
    : -1;
  const afterIndex = afterTaskId
    ? column.findIndex((entry) => entry.id === afterTaskId)
    : -1;

  if (beforeTaskId && beforeIndex === -1) {
    return { ok: false, message: MOVE_CONFLICT_MESSAGE };
  }
  if (afterTaskId && afterIndex === -1) {
    return { ok: false, message: MOVE_CONFLICT_MESSAGE };
  }
  if (beforeIndex !== -1 && afterIndex !== -1 && beforeIndex >= afterIndex) {
    return { ok: false, message: MOVE_CONFLICT_MESSAGE };
  }

  const before = beforeIndex === -1 ? null : column[beforeIndex] ?? null;
  const after = afterIndex === -1 ? null : column[afterIndex] ?? null;

  if (before && before.board_rank !== input.expectedBeforeRank) {
    return { ok: false, message: MOVE_CONFLICT_MESSAGE };
  }
  if (after && after.board_rank !== input.expectedAfterRank) {
    return { ok: false, message: MOVE_CONFLICT_MESSAGE };
  }

  let lower: string | null;
  let upper: string | null;

  if (before) {
    lower = before.board_rank;
    // The next canonical row may be hidden by the caller's filter.
    upper = after ? after.board_rank : column[beforeIndex + 1]?.board_rank ?? null;
  } else if (after) {
    upper = after.board_rank;
    lower = column[afterIndex - 1]?.board_rank ?? null;
  } else {
    lower = null;
    upper = null;
  }

  if (lower !== null && upper !== null && lower >= upper) {
    return { ok: false, message: MOVE_CONFLICT_MESSAGE };
  }

  if (lower === null && upper === null) {
    return { ok: true, boardRank: null };
  }

  try {
    return { ok: true, boardRank: generateBoardRankBetween(lower, upper) };
  } catch (error) {
    if (error instanceof BoardRankError) {
      return { ok: false, message: MOVE_CONFLICT_MESSAGE };
    }
    throw error;
  }
}


/**
 * Move a Task card between status columns and/or reorder it inside a column.
 *
 * Ordering and status are written in the same row update (`updateTaskInline`
 * owns the transition policy: blocked reason, completion, timer stop, recurrence
 * and calendar hand-off). Neighbour ranks plus the card's `updated_at` are the
 * optimistic-concurrency preconditions; a stale view is refused, never merged.
 */
export async function moveTaskOnBoardForOwner(
  input: MoveTaskOnBoardInput,
  options?: { supabase?: SupabaseServerClient },
): Promise<BoardMoveResult> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const ownerUserId = await getAuthenticatedUserId(supabase);
  if (!ownerUserId) {
    return fail("invalid", "Task move request is invalid.");
  }

  const taskId = normalizeId(input.taskId);
  const toStatus = normalizeId(input.toStatus);
  const beforeTaskId = normalizeOptionalId(input.beforeTaskId);
  const afterTaskId = normalizeOptionalId(input.afterTaskId);
  const expectedBeforeRank = normalizeOptionalRank(input.expectedBeforeRank);
  const expectedAfterRank = normalizeOptionalRank(input.expectedAfterRank);

  if (!taskId || !isTaskStatus(toStatus)) {
    return fail("invalid", "Task move request is invalid.");
  }
  if (
    expectedBeforeRank === undefined ||
    expectedAfterRank === undefined ||
    (beforeTaskId !== null && expectedBeforeRank === null) ||
    (afterTaskId !== null && expectedAfterRank === null)
  ) {
    return fail("invalid", "Task move request is invalid.");
  }
  if (
    beforeTaskId === taskId ||
    afterTaskId === taskId ||
    (beforeTaskId !== null && beforeTaskId === afterTaskId)
  ) {
    return fail("invalid", "Task move request is invalid.");
  }

  const { data: currentTask, error: currentTaskError } = await supabase
    .from("tasks")
    .select(
      "id, status, priority, due_date, estimate_minutes, blocked_reason, archived_at, updated_at, board_rank",
    )
    .eq("id", taskId)
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();

  if (currentTaskError) {
    return fail("invalid", "Unable to load task right now.");
  }
  if (!currentTask) {
    return fail("not_found", "Task was not found or is no longer available.");
  }
  if (currentTask.archived_at !== null) {
    return fail("invalid", "Archived tasks cannot be moved on the board.");
  }
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== currentTask.updated_at) {
    return fail("conflict", MOVE_CONFLICT_MESSAGE, true);
  }
  if (
    currentTask.status !== toStatus &&
    !isTaskStatusTransitionAllowed(currentTask.status, toStatus)
  ) {
    return fail(
      "forbidden_transition",
      "That status change is not available for this task.",
    );
  }

  const blockedReasonInput = String(input.blockedReason ?? "").trim();
  if (
    toStatus === "blocked" &&
    !blockedReasonInput &&
    !currentTask.blocked_reason?.trim()
  ) {
    return fail(
      "blocked_reason_required",
      "Blocked reason is required when status is Blocked.",
    );
  }

  const { data: columnRows, error: columnError } = await supabase
    .from("tasks")
    .select("id, board_rank")
    .eq("owner_user_id", ownerUserId)
    .eq("status", toStatus)
    .is("archived_at", null)
    .order("board_rank", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (columnError) {
    return fail("invalid", "Unable to load the target column right now.");
  }

  const column = (columnRows ?? []).filter(
    (row): row is BoardColumnEntry => row.id !== taskId,
  );
  const plan = planBoardMove({
    column,
    beforeTaskId,
    afterTaskId,
    expectedBeforeRank,
    expectedAfterRank,
  });

  if (!plan.ok) {
    return fail("conflict", plan.message, true);
  }

  const validation = validateTaskInlineUpdateInput({
    taskId,
    status: toStatus,
    priority: currentTask.priority,
    dueDate: currentTask.due_date ?? "",
    estimateMinutes: currentTask.estimate_minutes,
    blockedReason:
      toStatus === "blocked"
        ? blockedReasonInput || currentTask.blocked_reason
        : currentTask.blocked_reason,
  });

  if (validation.errorMessage || !validation.data) {
    return fail(
      "invalid",
      validation.errorMessage ?? "Task move request is invalid.",
    );
  }

  const { errorMessage } = await updateTaskInline(validation.data, {
    supabase,
    expectedUpdatedAt: currentTask.updated_at,
    boardRank: plan.boardRank,
  });

  if (errorMessage) {
    return fail(
      errorMessage.includes("changed since") ? "conflict" : "invalid",
      errorMessage,
      errorMessage.includes("changed since"),
    );
  }

  return {
    ok: true,
    taskId,
    status: toStatus,
    boardRank: plan.boardRank,
  };
}
