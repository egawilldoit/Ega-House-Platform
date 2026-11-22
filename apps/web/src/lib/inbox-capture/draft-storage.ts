/**
 * Browser-local draft storage shared by every Backlog/Inbox capture surface.
 *
 * This is deliberately a limited browser-only draft, not durable product data.
 * Keys are scoped to the verified owner id; when no owner is present nothing is
 * read or written, so a signed-out or switched account can never observe
 * another owner's draft. The canonical write remains the `captureInboxIdea`
 * server action under RLS.
 */

export type InboxCaptureDraft = {
  title: string;
  body: string;
  projectId: string;
  /** Stable idempotency key belonging to `keyContent`. */
  idempotencyKey: string;
  /** Serialized title/body/project for which the key was generated. */
  keyContent: string;
};

const DRAFT_STORAGE_PREFIX = "ega:inbox-capture-draft:";

export function inboxCaptureStorageKey(
  ownerUserId: string | null | undefined,
): string | null {
  if (!ownerUserId || typeof window === "undefined") {
    return null;
  }
  return `${DRAFT_STORAGE_PREFIX}${ownerUserId}`;
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `inbox-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function captureKeyContent(
  input: Pick<InboxCaptureDraft, "title" | "body" | "projectId">,
): string {
  return JSON.stringify([
    input.title.trim(),
    input.body.trim(),
    input.projectId.trim(),
  ]);
}

export function createEmptyCaptureDraft(): InboxCaptureDraft {
  return {
    title: "",
    body: "",
    projectId: "",
    idempotencyKey: createIdempotencyKey(),
    keyContent: captureKeyContent({ title: "", body: "", projectId: "" }),
  };
}

export function loadInboxCaptureDraft(
  ownerUserId: string | null | undefined,
): InboxCaptureDraft | null {
  const key = inboxCaptureStorageKey(ownerUserId);
  if (!key) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<InboxCaptureDraft> | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const title = typeof parsed.title === "string" ? parsed.title : "";
    const body = typeof parsed.body === "string" ? parsed.body : "";
    const projectId = typeof parsed.projectId === "string" ? parsed.projectId : "";
    const rawKey =
      typeof parsed.idempotencyKey === "string"
        ? parsed.idempotencyKey.trim()
        : "";
    return {
      title,
      body,
      projectId,
      idempotencyKey: rawKey || createIdempotencyKey(),
      keyContent:
        typeof parsed.keyContent === "string"
          ? parsed.keyContent
          : captureKeyContent({ title, body, projectId }),
    };
  } catch {
    return null;
  }
}

export function saveInboxCaptureDraft(
  ownerUserId: string | null | undefined,
  draft: InboxCaptureDraft,
): void {
  const key = inboxCaptureStorageKey(ownerUserId);
  if (!key) {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage can be unavailable or full. The in-memory draft still works.
  }
}

export function clearInboxCaptureDraft(
  ownerUserId: string | null | undefined,
): void {
  const key = inboxCaptureStorageKey(ownerUserId);
  if (!key) {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage restrictions; the in-memory draft is already reset.
  }
}

/**
 * Remove a stored draft only when it is still the exact draft being
 * acknowledged. Two workspace tabs share one owner-scoped key; an older tab
 * must never delete newer unsaved text written by another tab.
 */
export function clearInboxCaptureDraftIfUnchanged(
  ownerUserId: string | null | undefined,
  expected: InboxCaptureDraft,
): void {
  const key = inboxCaptureStorageKey(ownerUserId);
  if (!key) {
    return;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return;
    }
    const stored = JSON.parse(raw) as Partial<InboxCaptureDraft> | null;
    if (!stored || typeof stored !== "object") {
      return;
    }
    if (stored.idempotencyKey === expected.idempotencyKey) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore malformed storage or restrictions; never destroy unknown data.
  }
}
