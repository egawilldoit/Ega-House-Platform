/** Subtask checklist rules (EGA-782). Checklist items are not tasks. */
export const SUBTASK_TITLE_MAX = 256;

export type SubtaskTitleResult =
  | { ok: true; title: string }
  | { ok: false; errorMessage: string };

export function normalizeSubtaskTitle(value: unknown): SubtaskTitleResult {
  const title = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!title) return { ok: false, errorMessage: "A subtask title is required." };
  if (title.length > SUBTASK_TITLE_MAX) {
    return {
      ok: false,
      errorMessage: `Subtask title must be ${SUBTASK_TITLE_MAX} characters or fewer.`,
    };
  }
  return { ok: true, title };
}

/** Next free position at the end of an ordered checklist. */
export function nextSubtaskPosition(positions: ReadonlyArray<number>): number {
  return positions.reduce((max, position) => (position > max ? position : max), -1) + 1;
}

/**
 * Reorder one item within an ordered list. `direction` is the only supported
 * first implementation; drag can reuse the same result later.
 */
export function moveSubtaskPosition<T extends { id: string }>(
  items: readonly T[],
  subtaskId: string,
  direction: "up" | "down",
): T[] {
  const index = items.findIndex((item) => item.id === subtaskId);
  if (index === -1) return [...items];
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (!item) return [...items];
  next.splice(target, 0, item);
  return next;
}

export type SubtaskProgress = {
  done: number;
  total: number;
  label: string;
};

export function getSubtaskProgress(items: ReadonlyArray<{ done: boolean }>): SubtaskProgress {
  const total = items.length;
  const done = items.filter((item) => item.done).length;
  return { done, total, label: `${done}/${total}` };
}
