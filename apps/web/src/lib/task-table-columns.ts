import {
  parseTaskTableColumns,
  serializeTaskTableColumns,
  type TaskTableColumnConfig,
} from "@ega/contracts/common/task-list";

export {
  parseTaskTableColumns,
  serializeTaskTableColumns,
  type TaskTableColumnConfig,
};

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
