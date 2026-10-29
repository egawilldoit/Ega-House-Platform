import { TASK_STATUS_VALUES } from "@/lib/task-domain";

/**
 * Collapsed board columns, scoped to the owner and the active view (Current /
 * Archived / All). A browser preference is presentation only: it never stores
 * task data, and switching accounts cannot inherit another owner's layout.
 */
export const BOARD_COLLAPSED_STORAGE_PREFIX = "ega:tasks:board:collapsed";

export function boardCollapsedStorageKey(
  ownerId: string | null,
  view: string,
): string {
  return `${BOARD_COLLAPSED_STORAGE_PREFIX}:${ownerId ?? "anonymous"}:${view}`;
}

export function parseCollapsedColumns(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is (typeof TASK_STATUS_VALUES)[number] =>
      (TASK_STATUS_VALUES as readonly string[]).includes(value),
    );
  return [...new Set(values)];
}

export function serializeCollapsedColumns(values: readonly string[]): string {
  return parseCollapsedColumns(values.join(",")).join(",");
}

export function readCollapsedColumns(
  storage: Pick<Storage, "getItem"> | null,
  ownerId: string | null,
  view: string,
): string[] {
  if (!storage) return [];
  try {
    return parseCollapsedColumns(storage.getItem(boardCollapsedStorageKey(ownerId, view)));
  } catch {
    return [];
  }
}

export function writeCollapsedColumns(
  storage: Pick<Storage, "setItem"> | null,
  ownerId: string | null,
  view: string,
  values: readonly string[],
): void {
  if (!storage) return;
  try {
    storage.setItem(
      boardCollapsedStorageKey(ownerId, view),
      serializeCollapsedColumns(values),
    );
  } catch {
    // Private mode / disabled storage: keep the in-memory preference only.
  }
}

// ---------------------------------------------------------------------------
// Hydration-safe subscription for the board's collapse state.
//
// localStorage is an external store, so the board reads it through
// `useSyncExternalStore` (server snapshot: everything expanded) instead of
// mirroring it into React state inside an effect.
// ---------------------------------------------------------------------------
const listeners = new Set<() => void>();

export function subscribeBoardCollapsed(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(BOARD_COLLAPSED_STORAGE_PREFIX)) {
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function notifyBoardCollapsedChanged(): void {
  for (const listener of listeners) listener();
}

export function getBoardCollapsedSnapshot(
  ownerId: string | null,
  view: string,
): string {
  if (typeof window === "undefined") return "";
  return readCollapsedColumns(window.localStorage, ownerId, view).join(",");
}

export function getServerBoardCollapsedSnapshot(): string {
  return "";
}
