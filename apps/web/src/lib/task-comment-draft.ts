import { TASK_COMMENT_BODY_MAX } from "@ega/domain";

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
    typeof record.body === "string"
  );
}

export function readTaskCommentDraft(
  storage: Storage | null | undefined,
  ownerId: string | null | undefined,
  taskId: string | null | undefined,
): string {
  if (!storage || !ownerId || !taskId) return "";
  try {
    const raw = storage.getItem(taskCommentDraftKey(ownerId, taskId));
    if (!raw) return "";
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredDraft(parsed)) return "";
    if (parsed.ownerId !== ownerId || parsed.taskId !== taskId) return "";
    return parsed.body.slice(0, TASK_COMMENT_BODY_MAX);
  } catch {
    return "";
  }
}

export function writeTaskCommentDraft(
  storage: Storage | null | undefined,
  ownerId: string | null | undefined,
  taskId: string | null | undefined,
  body: string,
): void {
  if (!storage || !ownerId || !taskId) return;
  try {
    const key = taskCommentDraftKey(ownerId, taskId);
    if (!body.trim()) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(
      key,
      JSON.stringify({
        ownerId,
        taskId,
        body: body.slice(0, TASK_COMMENT_BODY_MAX),
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
