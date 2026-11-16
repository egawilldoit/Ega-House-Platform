/**
 * Browser-local storage for the unsaved Quick Notes scratchpad.
 *
 * This is deliberately a limited browser-only draft, not durable product data.
 * Keys are scoped to the verified owner id from the workspace shell; when no
 * owner is present nothing is read or written, so a signed-out or switched
 * account can never observe another owner's draft (DEC-2026-11-15-01 keeps the
 * server action / RLS boundary as the canonical write owner).
 */

export type QuickNoteDraft = {
  /** Complete unsaved scratchpad text. */
  text: string;
  /** Stable idempotency key belonging to `keyText`. */
  idempotencyKey: string;
  /** The exact text for which `idempotencyKey` was generated. */
  keyText: string;
};

const DRAFT_STORAGE_PREFIX = "ega:quick-notes-draft:";
const TITLE_MAX_LENGTH = 80;

export function quickNotesStorageKey(
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
  return `qn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createEmptyDraft(): QuickNoteDraft {
  return { text: "", idempotencyKey: createIdempotencyKey(), keyText: "" };
}

export function loadQuickNoteDraft(
  ownerUserId: string | null | undefined,
): QuickNoteDraft | null {
  const key = quickNotesStorageKey(ownerUserId);
  if (!key) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<QuickNoteDraft> | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const text = typeof parsed.text === "string" ? parsed.text : "";
    const storedKey =
      typeof parsed.idempotencyKey === "string"
        ? parsed.idempotencyKey.trim()
        : "";
    return {
      text,
      idempotencyKey: storedKey || createIdempotencyKey(),
      keyText: typeof parsed.keyText === "string" ? parsed.keyText : text,
    };
  } catch {
    return null;
  }
}

export function saveQuickNoteDraft(
  ownerUserId: string | null | undefined,
  draft: QuickNoteDraft,
): void {
  const key = quickNotesStorageKey(ownerUserId);
  if (!key) {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage can be unavailable or full. The in-memory draft still works.
  }
}

export function clearQuickNoteDraft(
  ownerUserId: string | null | undefined,
): void {
  const key = quickNotesStorageKey(ownerUserId);
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
 * acknowledged or discarded. Two workspace tabs share one owner-scoped key;
 * an older tab must never delete newer unsaved text written by another tab.
 */
export function clearQuickNoteDraftIfUnchanged(
  ownerUserId: string | null | undefined,
  expected: QuickNoteDraft,
): void {
  const key = quickNotesStorageKey(ownerUserId);
  if (!key) {
    return;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return;
    }
    const stored = JSON.parse(raw) as Partial<QuickNoteDraft> | null;
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

/** First nonempty line, bounded, with a fallback for untitled notes. */
export function deriveNoteTitle(text: string): string {
  const firstLine = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return "Quick note";
  }
  if (firstLine.length <= TITLE_MAX_LENGTH) {
    return firstLine;
  }
  return `${firstLine.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}
