export const TASK_DUE_FILTER_VALUES = [
  "all",
  "overdue",
  "due_today",
  "due_soon",
  "no_due_date",
] as const;

/**
 * Every supported list/table sort, with the shared field and direction each
 * value means. The web table header and the toolbar both resolve through this
 * map, so a header click and a toolbar selection can never disagree.
 */
export const TASK_SORT_DEFINITIONS = {
  updated_desc: { field: "updated", direction: "desc" },
  due_date_asc: { field: "due", direction: "asc" },
  due_date_desc: { field: "due", direction: "desc" },
  title_asc: { field: "title", direction: "asc" },
  title_desc: { field: "title", direction: "desc" },
  priority_asc: { field: "priority", direction: "asc" },
  priority_desc: { field: "priority", direction: "desc" },
  status_asc: { field: "status", direction: "asc" },
  status_desc: { field: "status", direction: "desc" },
  estimate_asc: { field: "estimate", direction: "asc" },
  estimate_desc: { field: "estimate", direction: "desc" },
  updated_asc: { field: "updated", direction: "asc" },
} as const;

export type TaskSortField =
  (typeof TASK_SORT_DEFINITIONS)[keyof typeof TASK_SORT_DEFINITIONS]["field"];
export type TaskSortDirection =
  (typeof TASK_SORT_DEFINITIONS)[keyof typeof TASK_SORT_DEFINITIONS]["direction"];
export type TaskSortValue = keyof typeof TASK_SORT_DEFINITIONS;

export const TASK_SORT_VALUES = Object.keys(TASK_SORT_DEFINITIONS) as TaskSortValue[];

export const DEFAULT_TASK_DUE_FILTER = "all" as const;
export const DEFAULT_TASK_SORT = "updated_desc" as const;

export type TaskDueFilter = (typeof TASK_DUE_FILTER_VALUES)[number];

export function isTaskDueFilter(value: string): value is TaskDueFilter {
  return TASK_DUE_FILTER_VALUES.includes(value as TaskDueFilter);
}

export function isTaskSortValue(value: string): value is TaskSortValue {
  return Object.prototype.hasOwnProperty.call(TASK_SORT_DEFINITIONS, value);
}

/**
 * Table columns whose configuration is persisted per view.
 *
 * `task` is the row anchor and is always visible/first; the remaining columns
 * can be hidden, resized and reordered. The action column is fixed and is not
 * part of this config.
 */
export const TASK_TABLE_COLUMN_IDS = [
  "task",
  "project",
  "priority",
  "due",
  "status",
  "estimate",
] as const;

export type TaskTableColumnId = (typeof TASK_TABLE_COLUMN_IDS)[number];

export const TASK_TABLE_COLUMN_MIN_WIDTH = 80;
export const TASK_TABLE_COLUMN_MAX_WIDTH = 480;

export type TaskTableColumnConfig = {
  id: TaskTableColumnId;
  width: number;
  visible: boolean;
};

/**
 * Defaults preserve the pre-EGA-792 inventory order (Task, Priority, Due,
 * Status). Project and estimate are available but hidden until requested, so an
 * old URL/saved view renders exactly the columns it did before.
 */
export const TASK_TABLE_DEFAULT_COLUMNS: readonly TaskTableColumnConfig[] = [
  { id: "task", width: 360, visible: true },
  { id: "project", width: 160, visible: false },
  { id: "priority", width: 112, visible: true },
  { id: "due", width: 152, visible: true },
  { id: "status", width: 144, visible: true },
  { id: "estimate", width: 112, visible: false },
];

const TASK_TABLE_DEFAULT_COLUMN_BY_ID = new Map(
  TASK_TABLE_DEFAULT_COLUMNS.map((column) => [column.id, column]),
);

export function isTaskTableColumnId(value: string): value is TaskTableColumnId {
  return (TASK_TABLE_COLUMN_IDS as readonly string[]).includes(value);
}

export function getTaskTableDefaultColumnWidth(id: TaskTableColumnId): number {
  return TASK_TABLE_DEFAULT_COLUMN_BY_ID.get(id)?.width ?? TASK_TABLE_COLUMN_MIN_WIDTH;
}

export function clampTaskTableColumnWidth(
  value: unknown,
  fallback = TASK_TABLE_COLUMN_MIN_WIDTH,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(
    TASK_TABLE_COLUMN_MAX_WIDTH,
    Math.max(TASK_TABLE_COLUMN_MIN_WIDTH, Math.round(numeric)),
  );
}

/**
 * Normalize an untrusted persisted column config.
 *
 * Unknown ids and duplicates are dropped, widths are clamped, `task` is forced
 * visible/first, and any column absent from the input falls back to its default.
 * An old saved view (no columns) therefore gets the same safe defaults as the
 * initial table render.
 */
export function normalizeTaskTableColumns(raw: unknown): TaskTableColumnConfig[] {
  const entries: TaskTableColumnConfig[] = [];
  const seen = new Set<TaskTableColumnId>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
      const idValue = (item as { id?: unknown }).id;
      if (typeof idValue !== "string" || !isTaskTableColumnId(idValue) || seen.has(idValue)) {
        continue;
      }
      seen.add(idValue);
      const fallback = TASK_TABLE_DEFAULT_COLUMN_BY_ID.get(idValue);
      const width = clampTaskTableColumnWidth(
        (item as { width?: unknown }).width,
        fallback?.width ?? TASK_TABLE_COLUMN_MIN_WIDTH,
      );
      const rawVisible = (item as { visible?: unknown }).visible;
      const visible =
        idValue === "task"
          ? true
          : typeof rawVisible === "boolean"
            ? rawVisible
            : (fallback?.visible ?? true);
      entries.push({ id: idValue, width, visible });
    }
  }

  // A missing column is an old view (or a future column added after the view
  // was saved): use its safe default rather than hiding it silently.
  for (const fallback of TASK_TABLE_DEFAULT_COLUMNS) {
    if (!seen.has(fallback.id)) entries.push({ ...fallback });
  }

  const task = entries.find((entry) => entry.id === "task") ?? {
    ...TASK_TABLE_DEFAULT_COLUMNS[0],
  };
  const rest = entries.filter((entry) => entry.id !== "task");
  const visible = rest.filter((entry) => entry.visible);
  const hidden = rest.filter((entry) => !entry.visible);

  return [{ ...task, visible: true }, ...visible, ...hidden];
}

export function areTaskTableColumnsEqual(
  left: readonly TaskTableColumnConfig[],
  right: readonly TaskTableColumnConfig[],
): boolean {
  return (
    left.length === right.length &&
    left.every((column, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        other.id === column.id &&
        other.width === column.width &&
        other.visible === column.visible
      );
    })
  );
}
