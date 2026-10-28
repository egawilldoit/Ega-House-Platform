import {
  TASK_COMMENT_BODY_MAX,
  normalizeTaskCommentRequestId,
} from "@ega/domain";

/**
 * Per-task comment drafts are local browser state, never product data.
 *
 * The key includes the verified owner id and every stored payload records it
 * again, so switching accounts cannot expose another owner's draft even if a
 * stale key is guessed. Sign-out does not need to erase the browser: a different
 * account only ever reads its own namespace.
 */
export const TASK_COMMENT_DRAFT_PREFIX = "ega:task-comment-draft:v1";

type StoredDraft = {
  ownerId: string;
  taskId: string;
  body: string;
  requestId?: string;
};

export type TaskCommentDraftState = {
  body: string;
  /** The retry identity that belongs to this exact draft, if one was saved. */
  requestId: string | null;
};

export function taskCommentDraftKey(ownerId: string, taskId: string): string {
  return `${TASK_COMMENT_DRAFT_PREFIX}:${encodeURIComponent(ownerId)}:${encodeURIComponent(taskId)}`;
}

function isStoredDraft(value: unknown): value is StoredDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ownerId === "string" &&
    typeof record.taskId === "string" &&
    typeof record.body === "string" &&
    (record.requestId === undefined || typeof record.requestId === "string")
  );
}

export function readTaskCommentDraftState(
  storage: Storage | null | undefined,
  ownerId: string | null | undefined,
  taskId: string | null | undefined,
): TaskCommentDraftState {
  if (!storage || !ownerId || !taskId) return { body: "", requestId: null };
  try {
    const raw = storage.getItem(taskCommentDraftKey(ownerId, taskId));
    if (!raw) return { body: "", requestId: null };
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredDraft(parsed)) return { body: "", requestId: null };
    if (parsed.ownerId !== ownerId || parsed.taskId !== taskId) {
      return { body: "", requestId: null };
    }
    const requestId = normalizeTaskCommentRequestId(parsed.requestId);
    return {
      body: parsed.body.slice(0, TASK_COMMENT_BODY_MAX),
      requestId: requestId.ok ? requestId.value : null,
    };
  } catch {
    return { body: "", requestId: null };
  }
}

export function readTaskCommentDraft(
  storage: Storage | null | undefined,
  ownerId: string | null | undefined,
  taskId: string | null | undefined,
): string {
  return readTaskCommentDraftState(storage, ownerId, taskId).body;
}

export function writeTaskCommentDraft(
  storage: Storage | null | undefined,
  ownerId: string | null | undefined,
  taskId: string | null | undefined,
  body: string,
  requestId?: string | null,
): void {
  if (!storage || !ownerId || !taskId) return;
  try {
    const key = taskCommentDraftKey(ownerId, taskId);
    if (!body.trim()) {
      storage.removeItem(key);
      return;
    }
    const normalizedRequestId = normalizeTaskCommentRequestId(requestId);
    storage.setItem(
      key,
      JSON.stringify({
        ownerId,
        taskId,
        body: body.slice(0, TASK_COMMENT_BODY_MAX),
        ...(normalizedRequestId.ok ? { requestId: normalizedRequestId.value } : {}),
      } satisfies StoredDraft),
    );
  } catch {
    // Storage may be unavailable (private mode); the composer stays session-only.
  }
}

export function clearTaskCommentDraft(
  storage: Storage | null | undefined,
  ownerId: string | null | undefined,
  taskId: string | null | undefined,
): void {
  if (!storage || !ownerId || !taskId) return;
  try {
    storage.removeItem(taskCommentDraftKey(ownerId, taskId));
  } catch {
    // Ignore unavailable storage.
  }
}
