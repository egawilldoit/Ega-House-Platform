import {
  TASK_TABLE_DEFAULT_COLUMNS,
  clampTaskTableColumnWidth,
  getTaskTableDefaultColumnWidth,
  isTaskTableColumnId,
  normalizeTaskTableColumns,
  type TaskTableColumnConfig,
  type TaskTableColumnId,
} from "@ega/contracts/common/task-list";

export const TASK_TABLE_COLUMNS_PARAM = "cols";
export const TASK_TABLE_WIDTHS_PARAM = "widths";

/** Fields the table cell editors may patch. Title/description stay in the drawer. */
export const TASK_TABLE_EDITABLE_FIELDS = [
  "status",
  "priority",
  "project",
  "dueDate",
  "estimateMinutes",
] as const;

export type TaskTableCellEditableField = (typeof TASK_TABLE_EDITABLE_FIELDS)[number];

export function isTaskTableCellEditableField(
  value: string,
): value is TaskTableCellEditableField {
  return (TASK_TABLE_EDITABLE_FIELDS as readonly string[]).includes(value);
}

const DEFAULT_VISIBLE_COLUMNS = TASK_TABLE_DEFAULT_COLUMNS.filter(
  (column) => column.visible,
).map((column) => column.id);

function splitList(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseWidthOverrides(value: string | null | undefined): Map<TaskTableColumnId, number> {
  const widths = new Map<TaskTableColumnId, number>();

  for (const entry of splitList(value)) {
    const separator = entry.indexOf(":");
    if (separator <= 0) continue;
    const id = entry.slice(0, separator).trim();
    const rawWidth = entry.slice(separator + 1).trim();
    if (!isTaskTableColumnId(id) || widths.has(id) || !rawWidth) continue;
    const width = Number(rawWidth);
    if (!Number.isFinite(width)) continue;
    widths.set(id, clampTaskTableColumnWidth(width, getTaskTableDefaultColumnWidth(id)));
  }

  return widths;
}

/**
 * Parse the table's compact URL contract.
 *
 * `cols` is the ordered list of visible column ids; `widths` carries only
 * non-default widths. Missing values fall back to the same defaults an old
 * saved view receives. Unknown ids, duplicates and widths outside the bounds
 * are dropped/clamped rather than trusted.
 */
export function parseTaskTableColumns(input: {
  cols?: string | null;
  widths?: string | null;
}): TaskTableColumnConfig[] {
  const requestedOrder: TaskTableColumnId[] = [];
  const seen = new Set<TaskTableColumnId>();
  for (const entry of splitList(input.cols)) {
    if (!isTaskTableColumnId(entry) || seen.has(entry)) continue;
    seen.add(entry);
    requestedOrder.push(entry);
  }

  const visibleOrder =
    requestedOrder.length > 0 ? requestedOrder : DEFAULT_VISIBLE_COLUMNS;
  const orderedVisible = [
    "task" as const,
    ...visibleOrder.filter((id) => id !== "task"),
  ];
  const visible = new Set<TaskTableColumnId>(orderedVisible);
  const widths = parseWidthOverrides(input.widths);
  const remaining = TASK_TABLE_DEFAULT_COLUMNS.map((column) => column.id).filter(
    (id) => !visible.has(id),
  );

  return normalizeTaskTableColumns(
    [...orderedVisible, ...remaining].map((id) => ({
      id,
      width: widths.get(id) ?? getTaskTableDefaultColumnWidth(id),
      visible: visible.has(id),
    })),
  );
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Serialize only the deviations from the defaults, keeping ordinary view URLs
 * short and preserving every caller that does not use column configuration.
 */
export function serializeTaskTableColumns(columns: readonly TaskTableColumnConfig[]): {
  cols: string | null;
  widths: string | null;
} {
  const orderedVisible = columns.filter((column) => column.visible).map((column) => column.id);
  const cols =
    orderedVisible.length === 0 || sameOrder(orderedVisible, DEFAULT_VISIBLE_COLUMNS)
      ? null
      : orderedVisible.join(",");
  const widths = columns
    .filter((column) => column.width !== getTaskTableDefaultColumnWidth(column.id))
    .map((column) => `${column.id}:${column.width}`)
    .join(",");

  return { cols, widths: widths || null };
}

export function setTaskTableUrlParam(
  url: string,
  key: string,
  value: string | null,
): string {
  const parsed = new URL(url, "http://ega.local");
  if (value) parsed.searchParams.set(key, value);
  else parsed.searchParams.delete(key);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Replace the table column state in an existing view URL. */
export function buildTaskTableColumnsUrl(
  url: string,
  columns: readonly TaskTableColumnConfig[],
): string {
  const serialized = serializeTaskTableColumns(columns);
  return setTaskTableUrlParam(
    setTaskTableUrlParam(url, TASK_TABLE_COLUMNS_PARAM, serialized.cols),
    TASK_TABLE_WIDTHS_PARAM,
    serialized.widths,
  );
}
