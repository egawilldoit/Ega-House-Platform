"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Columns3,
  RotateCcw,
} from "lucide-react";

import { TaskCardActions } from "@/components/tasks/task-card-actions";
import type { UpdateTaskEditorAction } from "@/components/tasks/edit-task-modal";
import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { EstimateVsActualBadge } from "@/components/tasks/estimate-vs-actual-badge";
import { Badge } from "@/components/ui/badge";
import { buildTaskDrawerHref } from "@/components/tasks/drawer/use-task-drawer-param";
import { StatusBadge } from "@/components/ui/status-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTaskEditorOpenState } from "@/components/tasks/use-task-editor-open-state";
import { getLocalDateInTimezone } from "@ega/domain/time-context";
import { useDisplayTimezone } from "@/lib/hooks/use-display-timezone";
import { getTaskDueDateState } from "@/lib/task-due-date";
import { isTaskArchived } from "@/lib/task-archive";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  formatTaskToken,
  isTaskCompletedStatus,
} from "@/lib/task-domain";
import {
  formatDisplayDate,
  formatDisplayEstimate,
  formatDisplayStatus,
} from "@/lib/presentation-format";
import type { TaskRecord } from "@/lib/services/task-service";
import type {
  TaskTableCellUpdateInput,
  TaskTableCellUpdateResult,
} from "@/app/tasks/actions";
import {
  TASK_TABLE_COLUMN_MAX_WIDTH,
  TASK_TABLE_COLUMN_MIN_WIDTH,
  TASK_TABLE_DEFAULT_COLUMNS,
  clampTaskTableColumnWidth,
  getDefaultTaskViewSortDirection,
  getTaskTableDefaultColumnWidth,
  type TaskTableColumnConfig,
  type TaskTableColumnId,
  type TaskViewSortDirection,
  type TaskViewSortKey,
} from "@ega/contracts/common/task-list";
import {
  buildTaskTableColumnsUrl,
  setTaskTableUrlParam,
} from "@/lib/task-table-columns";
import { TaskBulkBar, type TaskBulkActions } from "../task-bulk-bar";
import {
  TASK_TABLE_COLUMN_LABELS,
  TASK_TABLE_COLUMN_SORT_FIELD,
  nextTaskViewSort,
} from "./column-config";
import { useColumnResize } from "./use-column-resize";

export type TaskTableActions = {
  updateAction: (formData: FormData) => void | Promise<void>;
  updateEditorAction: UpdateTaskEditorAction;
  deleteAction: (formData: FormData) => void | Promise<void>;
  archiveAction: (formData: FormData) => void | Promise<void>;
  unarchiveAction: (formData: FormData) => void | Promise<void>;
  startTimerAction: (formData: FormData) => void | Promise<void>;
  pinAction: (formData: FormData) => void | Promise<void>;
  unpinAction: (formData: FormData) => void | Promise<void>;
  createReminderAction: (formData: FormData) => void | Promise<void>;
  updateReminderAction: (formData: FormData) => void | Promise<void>;
  cancelReminderAction: (formData: FormData) => void | Promise<void>;
  bulkFieldAction: TaskBulkActions["bulkFieldAction"];
  bulkArchiveAction: TaskBulkActions["bulkArchiveAction"];
  undoAction: TaskBulkActions["undoAction"];
  updateCellAction: (input: TaskTableCellUpdateInput) => Promise<TaskTableCellUpdateResult>;
};

type TaskTableProps = {
  tasks: TaskRecord[];
  taskTotalDurations: Record<string, number>;
  subtaskCounts?: Record<string, { done: number; total: number }>;
  returnTo: string;
  columns: TaskTableColumnConfig[];
  sortKey: TaskViewSortKey;
  sortDirection: TaskViewSortDirection;
  taskUpdateTaskId: string | null;
  taskUpdateError: string | null;
  projectOptions?: Array<{ id: string; name: string }>;
  goalOptions?: Array<{ id: string; title: string; projectId: string }>;
  density?: "comfortable" | "compact";
  actions: TaskTableActions;
};

const ACTIONS_COLUMN_WIDTH = 132;
const COLUMN_WIDTH_PRESETS = { narrow: 96, wide: 240 } as const;

function columnSignature(columns: readonly TaskTableColumnConfig[]): string {
  return columns.map((column) => `${column.id}:${column.width}:${column.visible}`).join("|");
}

function effectiveWidth(
  column: TaskTableColumnConfig,
  preview: { id: string; width: number } | null,
): number {
  return preview?.id === column.id ? preview.width : column.width;
}

/**
 * Spreadsheet-style task table.
 *
 * Column visibility/order/width is URL-authoritative (`cols`/`widths`) and can
 * be saved per view. Header sort writes the same `sort`/`dir` pair the toolbar
 * consumes. Inline editors reuse the canonical single-field patch, carry the
 * rendered row revision as a concurrency precondition and keep their draft on
 * failure. Phone widths keep the existing stacked task-row presentation, so
 * the table never forces document-level horizontal overflow.
 */
export function TaskTable({
  tasks,
  taskTotalDurations,
  subtaskCounts = {},
  returnTo,
  columns: initialColumns,
  sortKey,
  sortDirection,
  taskUpdateTaskId,
  taskUpdateError,
  projectOptions = [],
  goalOptions = [],
  density = "comfortable",
  actions,
}: TaskTableProps) {
  const router = useRouter();
  const [columns, setColumns] = useState<TaskTableColumnConfig[]>(initialColumns);
  const columnsRef = useRef(columns);
  const lastServerSignatureRef = useRef(columnSignature(initialColumns));
  const tableRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const visibleColumns = columns.filter((column) => column.visible);

  const commitColumns = (next: TaskTableColumnConfig[], focusTarget?: string) => {
    columnsRef.current = next;
    setColumns(next);
    if (focusTarget) pendingFocusRef.current = focusTarget;
    router.replace(buildTaskTableColumnsUrl(returnTo, next), { scroll: false });
  };

  const commitWidth = (id: string, width: number) => {
    const next = columnsRef.current.map((column) =>
      column.id === id ? { ...column, width: clampTaskTableColumnWidth(width, column.width) } : column,
    );
    commitColumns(next, `resize:${id}`);
  };

  const columnResize = useColumnResize(commitWidth);
  const { clearPreview, preview: resizePreview, resizingId } = columnResize;
  const serverColumnSignature = columnSignature(initialColumns);

  // Adopt a new server/URL column state (saved view, Back/Forward, explicit
  // link). Local edits update state immediately; the signature guard prevents
  // an unrelated parent render from reverting them before the URL catches up.
  useEffect(() => {
    if (serverColumnSignature === lastServerSignatureRef.current) return;
    lastServerSignatureRef.current = serverColumnSignature;
    const next = initialColumns.map((column) => ({ ...column }));
    columnsRef.current = next;
    setColumns(next);
    clearPreview();
  }, [serverColumnSignature, initialColumns, clearPreview]);

  useEffect(() => {
    const focusTarget = pendingFocusRef.current;
    if (!focusTarget) return;
    pendingFocusRef.current = null;
    const element =
      tableRef.current?.querySelector<HTMLElement>(`[data-column-focus="${focusTarget}"]`) ??
      document.querySelector<HTMLElement>(`[data-column-focus="${focusTarget}"]`);
    element?.focus();
  }, [columns]);

  const toggleColumn = (id: TaskTableColumnId) => {
    if (id === "task") return;
    const target = columnsRef.current.find((column) => column.id === id);
    if (!target) return;
    const rest = columnsRef.current.filter((column) => column.id !== id);
    const visible = rest.filter((column) => column.visible);
    const hidden = rest.filter((column) => !column.visible);
    const next = target.visible
      ? [...visible, { ...target, visible: false }, ...hidden]
      : [...visible, { ...target, visible: true }, ...hidden];
    commitColumns(next, `toggle:${id}`);
  };

  const moveColumn = (id: TaskTableColumnId, direction: -1 | 1) => {
    const visible = columnsRef.current.filter((column) => column.visible);
    const index = visible.findIndex((column) => column.id === id);
    const nextIndex = index + direction;
    if (index <= 0 || nextIndex <= 0 || nextIndex >= visible.length) return;
    const reordered = [...visible];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    const hidden = columnsRef.current.filter((column) => !column.visible);
    commitColumns([...reordered, ...hidden], `${direction === -1 ? "up" : "down"}:${id}`);
  };

  const setColumnWidth = (id: TaskTableColumnId, width: number) => {
    commitColumns(
      columnsRef.current.map((column) =>
        column.id === id
          ? { ...column, width: clampTaskTableColumnWidth(width, column.width) }
          : column,
      ),
      `width:${id}`,
    );
  };

  const resetColumns = () => {
    commitColumns(
      TASK_TABLE_DEFAULT_COLUMNS.map((column) => ({ ...column })),
      "reset",
    );
  };

  const buildSortHref = (field: TaskViewSortKey) => {
    const next = nextTaskViewSort(
      { key: sortKey, direction: sortDirection },
      field,
    );
    const isDefaultSort = next.key === "updated" && next.direction === "desc";
    const omitDirection = next.direction === getDefaultTaskViewSortDirection(next.key);
    let nextUrl = buildTaskTableColumnsUrl(returnTo, columns);
    nextUrl = setTaskTableUrlParam(nextUrl, "sort", isDefaultSort ? null : next.key);
    nextUrl = setTaskTableUrlParam(
      nextUrl,
      "dir",
      isDefaultSort || omitDirection ? null : next.direction,
    );
    return nextUrl;
  };

  const visibleIds = tasks.map((task) => task.id);
  const selectedVisibleIds = selectedIds.filter((id) => visibleIds.includes(id));
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const anyArchived = tasks.some(
    (task) => selectedIds.includes(task.id) && isTaskArchived(task.archived_at),
  );

  const toggle = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );

  // Ctrl/Cmd+A applies only to this rendered selection surface, never while a
  // text field owns focus; Escape clears it.
  useEffect(() => {
    const node = tableRef.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (editable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(tasks.map((task) => task.id));
        return;
      }
      if (event.key === "Escape") {
        setSelectedIds([]);
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [tasks]);

  const totalWidth =
    visibleColumns.reduce(
      (total, column) => total + effectiveWidth(column, resizePreview),
      0,
    ) + ACTIONS_COLUMN_WIDTH;
  const tableStyle = {
    "--table-min-width": `${totalWidth}px`,
  } as unknown as CSSProperties;

  return (
    <div
      ref={tableRef}
      tabIndex={-1}
      className={`overflow-x-auto${density === "compact" ? " data-table--density-compact" : ""}`}
    >
      {selectedVisibleIds.length > 0 ? (
        <TaskBulkBar
          selectedIds={selectedVisibleIds}
          returnTo={returnTo}
          projectOptions={projectOptions}
          anyArchived={anyArchived}
          actions={actions}
          onClear={() => setSelectedIds([])}
        />
      ) : null}

      <div
        id="saved-views"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ega-divider)] px-3 py-1.5 max-[761px]:hidden"
      >
        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          {visibleColumns.length} of {columns.length} columns
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <ColumnSettings
            columns={columns}
            onToggle={toggleColumn}
            onMove={moveColumn}
            onWidth={setColumnWidth}
            onReset={resetColumns}
          />
        </div>
      </div>

      <table
        className="data-table table-fixed max-[761px]:block min-[761px]:w-full min-[761px]:min-w-[var(--table-min-width)] [&_td]:px-2 [&_th]:px-2"
        style={tableStyle}
      >
        <thead className="max-[761px]:hidden">
          <tr>
            {visibleColumns.map((column) => {
              const label = TASK_TABLE_COLUMN_LABELS[column.id];
              const sortField = TASK_TABLE_COLUMN_SORT_FIELD[column.id];
              const direction =
                sortField && sortKey === sortField ? sortDirection : null;
              const width = effectiveWidth(column, resizePreview);
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={
                    sortField
                      ? direction === "asc"
                        ? "ascending"
                        : direction === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                  style={{ width }}
                  className="relative"
                >
                  <div className="relative flex min-w-0 items-center gap-1.5">
                    {column.id === "task" ? (
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0"
                        checked={allVisibleSelected}
                        onChange={() =>
                          setSelectedIds(
                            allVisibleSelected ? [] : tasks.map((task) => task.id),
                          )
                        }
                        aria-label="Select all tasks in this view"
                      />
                    ) : null}
                    {sortField ? (
                      <SortHeaderLink
                        label={label}
                        direction={direction}
                        href={buildSortHref(sortField)}
                      />
                    ) : (
                      <span className="min-w-0 truncate">{label}</span>
                    )}
                  </div>
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    tabIndex={0}
                    aria-label={`Resize ${label} column`}
                    aria-valuemin={TASK_TABLE_COLUMN_MIN_WIDTH}
                    aria-valuemax={TASK_TABLE_COLUMN_MAX_WIDTH}
                    aria-valuenow={Math.round(width)}
                    data-column-focus={`resize:${column.id}`}
                    data-testid={`column-resize-${column.id}`}
                    onPointerDown={(event) => columnResize.beginPointer(column.id, width, event)}
                    onPointerMove={columnResize.movePointer}
                    onPointerUp={columnResize.endPointer}
                    onPointerCancel={columnResize.cancelPointer}
                    onKeyDown={(event) => columnResize.handleKeyboard(event, column.id, width)}
                    onKeyUp={(event) => {
                      if (
                        ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                      ) {
                        columnResize.commitKeyboard();
                      }
                    }}
                    onBlur={columnResize.commitKeyboard}
                    className={`absolute -right-1 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none rounded-[var(--radius-pill)] ${
                      resizingId === column.id
                        ? "bg-[var(--ega-accent)]"
                        : "bg-transparent hover:bg-[var(--ega-border-strong)] focus-visible:bg-[var(--ega-accent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ega-focus-outline)]"
                    }`}
                  />
                </th>
              );
            })}
            <th scope="col" style={{ width: ACTIONS_COLUMN_WIDTH }} className="text-right">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="max-[761px]:block">
          {tasks.map((task) => (
            <TaskTableRow
              key={task.id}
              task={task}
              trackedSeconds={taskTotalDurations[task.id]}
              subtaskCount={subtaskCounts[task.id] ?? null}
              returnTo={returnTo}
              visibleColumns={visibleColumns}
              inlineError={taskUpdateTaskId === task.id ? taskUpdateError : null}
              projectOptions={projectOptions}
              goalOptions={goalOptions}
              actions={actions}
              selected={selectedIds.includes(task.id)}
              onToggleSelected={() => toggle(task.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHeaderLink({
  label,
  direction,
  href,
}: {
  label: string;
  direction: TaskViewSortDirection | null;
  href: string;
}) {
  const stateLabel =
    direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "not sorted";

  return (
    <Link
      href={href}
      scroll={false}
      className="inline-flex min-w-0 items-center gap-1 text-inherit outline-none hover:text-[color:var(--ega-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
      aria-label={`Sort by ${label}, currently ${stateLabel}`}
      data-testid={`sort-header-${label.toLowerCase()}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      {direction === "asc" ? (
        <ArrowUp aria-hidden="true" className="size-3 shrink-0" />
      ) : direction === "desc" ? (
        <ArrowDown aria-hidden="true" className="size-3 shrink-0" />
      ) : (
        <ChevronsUpDown aria-hidden="true" className="size-3 shrink-0 opacity-50" />
      )}
    </Link>
  );
}

function ColumnSettings({
  columns,
  onToggle,
  onMove,
  onWidth,
  onReset,
}: {
  columns: TaskTableColumnConfig[];
  onToggle: (id: TaskTableColumnId) => void;
  onMove: (id: TaskTableColumnId, direction: -1 | 1) => void;
  onWidth: (id: TaskTableColumnId, width: number) => void;
  onReset: () => void;
}) {
  const visibleColumns = columns.filter((column) => column.visible);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="filter-pill"
          data-testid="table-columns-trigger"
          aria-haspopup="dialog"
        >
          <Columns3 aria-hidden="true" className="h-3.5 w-3.5" />
          <span>Columns</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        role="dialog"
        aria-label="Table columns"
        className="w-[min(22rem,calc(100vw-1rem))] p-2"
      >
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <p className="text-[length:var(--text-meta)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[color:var(--ega-text-tertiary)]">
            Columns
          </p>
          <button
            type="button"
            onClick={onReset}
            data-column-focus="reset"
            data-testid="table-columns-reset"
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
          >
            <RotateCcw aria-hidden="true" className="size-3" />
            Reset
          </button>
        </div>

        <ul className="flex flex-col gap-0.5" aria-label="Table columns">
          {columns.map((column) => {
            const label = TASK_TABLE_COLUMN_LABELS[column.id];
            const visibleIndex = visibleColumns.findIndex((entry) => entry.id === column.id);
            const defaultWidth = getTaskTableDefaultColumnWidth(column.id);
            const preset =
              column.width === COLUMN_WIDTH_PRESETS.narrow
                ? "narrow"
                : column.width === COLUMN_WIDTH_PRESETS.wide
                  ? "wide"
                  : column.width === defaultWidth
                    ? "default"
                    : "custom";

            return (
              <li
                key={column.id}
                className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] px-1 py-1 hover:bg-[var(--ega-surface-hover)]"
              >
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-[color:var(--ega-text-secondary)]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0"
                    checked={column.visible}
                    disabled={column.id === "task"}
                    onChange={() => onToggle(column.id)}
                    data-column-focus={`toggle:${column.id}`}
                    aria-label={`Show ${label} column`}
                  />
                  <span className="truncate">{label}</span>
                </label>

                <select
                  value={preset}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "narrow") onWidth(column.id, COLUMN_WIDTH_PRESETS.narrow);
                    else if (value === "wide") onWidth(column.id, COLUMN_WIDTH_PRESETS.wide);
                    else if (value === "default") onWidth(column.id, defaultWidth);
                  }}
                  data-column-focus={`width:${column.id}`}
                  aria-label={`Width for ${label} column`}
                  className="h-7 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1 text-[length:var(--text-meta)] text-[color:var(--ega-text)]"
                >
                  {preset === "custom" ? (
                    <option value="custom">Custom ({column.width}px)</option>
                  ) : null}
                  <option value="narrow">Narrow</option>
                  <option value="default">Default</option>
                  <option value="wide">Wide</option>
                </select>

                <button
                  type="button"
                  onClick={() => onMove(column.id, -1)}
                  disabled={
                    !column.visible || column.id === "task" || visibleIndex <= 1
                  }
                  data-column-focus={`up:${column.id}`}
                  aria-label={`Move ${label} column up`}
                  className="inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
                >
                  <ChevronUp aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(column.id, 1)}
                  disabled={
                    !column.visible ||
                    column.id === "task" ||
                    visibleIndex < 0 ||
                    visibleIndex >= visibleColumns.length - 1
                  }
                  data-column-focus={`down:${column.id}`}
                  aria-label={`Move ${label} column down`}
                  className="inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
                >
                  <ChevronDown aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>

        <p className="px-1 pt-1.5 text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-[color:var(--ega-text-tertiary)]">
          Drag a column&apos;s right edge, or use the width presets and arrow keys while
          the resize handle is focused.
        </p>
      </PopoverContent>
    </Popover>
  );
}

const DUE_STATE_CLASS: Record<ReturnType<typeof getTaskDueDateState>, string> = {
  overdue: "text-[color:var(--status-overdue)] font-medium",
  today: "text-[color:var(--status-info)] font-medium",
  soon: "text-[color:var(--ega-text)]",
  scheduled: "text-[color:var(--ega-text-secondary)]",
  none: "text-[color:var(--ega-text-secondary)]",
};

const DUE_STATE_LABEL: Record<ReturnType<typeof getTaskDueDateState>, string | null> = {
  overdue: "Overdue",
  today: "Due today",
  soon: "Due soon",
  scheduled: null,
  none: null,
};

function TaskDueCell({ dueDate, status }: { dueDate: string | null; status: string }) {
  const todayIsoDate = getLocalDateInTimezone(new Date(), useDisplayTimezone());

  if (!dueDate) {
    return (
      <span className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-tertiary)]">—</span>
    );
  }

  const dueState = getTaskDueDateState(dueDate, status, todayIsoDate);
  const stateLabel = DUE_STATE_LABEL[dueState];

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[length:var(--text-meta)] tabular-nums ${DUE_STATE_CLASS[dueState]}`}
      title={formatDisplayDate(dueDate, "detail")}
    >
      {formatDisplayDate(dueDate, "compact")}
      {stateLabel ? <span>· {stateLabel}</span> : null}
    </span>
  );
}

function TaskContextLine({
  projectName,
  goalTitle,
}: {
  projectName: string | null;
  goalTitle: string | null;
}) {
  if (!projectName && !goalTitle) {
    return null;
  }

  const projectPart = projectName ? (
    <span className="min-w-0 max-w-[20ch] truncate" title={projectName}>
      {projectName}
    </span>
  ) : null;
  const separator =
    projectName && goalTitle ? (
      <span className="shrink-0 text-[color:var(--ega-text-tertiary)]" aria-hidden="true">
        ·
      </span>
    ) : null;
  const goalPart = goalTitle ? (
    <span className="min-w-0 truncate" title={goalTitle}>
      {goalTitle}
    </span>
  ) : null;

  return (
    <div
      className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]"
      data-testid="task-context-line"
    >
      {projectPart}
      {separator}
      {goalPart}
    </div>
  );
}

type RowSaveResult = { errorMessage: string | null };

function TaskTableRow({
  task,
  trackedSeconds,
  returnTo,
  visibleColumns,
  inlineError,
  projectOptions,
  goalOptions,
  actions,
  selected,
  onToggleSelected,
  subtaskCount,
}: {
  task: TaskRecord;
  trackedSeconds?: number;
  returnTo: string;
  visibleColumns: TaskTableColumnConfig[];
  inlineError: string | null;
  projectOptions: Array<{ id: string; name: string }>;
  goalOptions: Array<{ id: string; title: string; projectId: string }>;
  actions: TaskTableActions;
  selected: boolean;
  onToggleSelected: () => void;
  subtaskCount?: { done: number; total: number } | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [overrides, setOverrides] = useState<
    Record<string, { value: string; updatedAt: string }>
  >({});
  const [pendingField, setPendingField] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const versionRef = useRef(task.updated_at);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const editorOpenerRef = useRef<HTMLElement | null>(null);

  const { open, handleOpenChange } = useTaskEditorOpenState({
    taskId: task.id,
    error: inlineError,
  });

  // A successful write may render before the server refresh arrives. Keep its
  // value only while the rendered row is still older than the write; a newer
  // callers' refresh wins without a state-resetting effect.
  const overrideFor = (field: string) => {
    const entry = overrides[field];
    if (!entry) return undefined;
    return Date.parse(task.updated_at) < Date.parse(entry.updatedAt)
      ? entry.value
      : undefined;
  };
  const expectedUpdatedAt = () =>
    Date.parse(task.updated_at) >= Date.parse(versionRef.current)
      ? task.updated_at
      : versionRef.current;

  const saveField = async (field: string, value: string): Promise<RowSaveResult> => {
    if (pendingRef.current) {
      return { errorMessage: "Wait for the current cell to finish saving." };
    }
    pendingRef.current = field;
    setPendingField(field);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));

    try {
      const result = await actions.updateCellAction({
        taskId: task.id,
        field,
        value,
        expectedUpdatedAt: expectedUpdatedAt(),
        returnTo,
      });
      if (result.errorMessage) {
        const message = result.errorMessage;
        setFieldErrors((current) => ({ ...current, [field]: message }));
        return { errorMessage: message };
      }
      const updatedAt = result.updatedAt ?? versionRef.current;
      versionRef.current = updatedAt;
      setOverrides((current) => ({
        ...current,
        [field]: { value: result.savedValue ?? value, updatedAt },
      }));
      startTransition(() => router.refresh());
      return { errorMessage: null };
    } catch {
      const message = "Unable to save right now. Your change is kept — try again.";
      setFieldErrors((current) => ({ ...current, [field]: message }));
      return { errorMessage: message };
    } finally {
      pendingRef.current = null;
      setPendingField(null);
    }
  };

  const archived = isTaskArchived(task.archived_at);
  const status = overrideFor("status") ?? task.status;
  const done = isTaskCompletedStatus(status);
  const isPinned = task.focus_rank !== null;
  const priority = overrideFor("priority") ?? task.priority;
  const dueOverride = overrideFor("dueDate");
  const dueDate = dueOverride !== undefined ? dueOverride : task.due_date;
  const estimateOverride = overrideFor("estimateMinutes");
  const estimateMinutes =
    estimateOverride !== undefined
      ? estimateOverride
        ? Number(estimateOverride)
        : null
      : task.estimate_minutes;
  const projectId = overrideFor("project") ?? task.project_id;
  const projectName =
    projectId !== task.project_id
      ? (projectOptions.find((project) => project.id === projectId)?.name ?? null)
      : (task.projects?.name ?? null);
  const goalTitle = task.goals?.title ?? null;
  const hasEstimate =
    estimateMinutes !== null &&
    estimateMinutes !== undefined &&
    Number.isFinite(estimateMinutes);
  const trackedValue = typeof trackedSeconds === "number" ? trackedSeconds : null;

  const rowActions = (
    <TaskCardActions
      compact
      open={open}
      onOpenChange={handleOpenChange}
      restoreFocusRef={editorOpenerRef}
      onEditorTriggerActivate={(element) => {
        editorOpenerRef.current = element;
      }}
      action={actions.updateAction}
      updateEditorAction={actions.updateEditorAction}
      deleteAction={actions.deleteAction}
      archiveAction={actions.archiveAction}
      unarchiveAction={actions.unarchiveAction}
      startTimerAction={actions.startTimerAction}
      createReminderAction={actions.createReminderAction}
      updateReminderAction={actions.updateReminderAction}
      cancelReminderAction={actions.cancelReminderAction}
      taskReminders={task.task_reminders}
      taskId={task.id}
      taskTitle={task.title}
      taskDescription={task.description}
      projectName={projectName}
      goalTitle={goalTitle}
      defaultProjectId={projectId}
      defaultGoalId={task.goal_id}
      projectOptions={projectOptions}
      goalOptions={goalOptions}
      returnTo={returnTo}
      defaultStatus={status}
      defaultPriority={priority}
      defaultDueDate={dueDate}
      defaultEstimateMinutes={estimateMinutes}
      defaultScheduledStartAt={task.scheduled_start_at}
      defaultScheduledEndAt={task.scheduled_end_at}
      defaultCalendarSyncEnabled={task.calendar_sync_enabled}
      defaultCalendarReminderMinutes={task.calendar_reminder_minutes}
      defaultBlockedReason={task.blocked_reason}
      defaultRecurrenceRule={task.task_recurrences[0]?.rule ?? null}
      archivedAt={task.archived_at}
      error={inlineError}
      overflowActions={
        !archived ? (
          <FocusPinToggleForm
            action={isPinned ? actions.unpinAction : actions.pinAction}
            taskId={task.id}
            returnTo={returnTo}
            isPinned={isPinned}
            className="w-full"
            fullWidth
          />
        ) : null
      }
    />
  );

  const drawerHref = (() => {
    const base = new URL(returnTo, "http://ega.local");
    return buildTaskDrawerHref(base.pathname, base.searchParams, { taskId: task.id });
  })();

  const titleLink = (
    <Link
      href={drawerHref}
      scroll={false}
      className="task-row-title-btn"
      title={task.title}
      aria-label={`Open ${task.title} details`}
      data-testid={`task-title-open-${task.id}`}
    >
      {task.title}
    </Link>
  );

  const statusOptions = TASK_STATUS_VALUES.filter(
    (statusValue) =>
      statusValue !== "blocked" || Boolean(task.blocked_reason) || status === "blocked",
  ).map((statusValue) => ({
    value: statusValue,
    label: formatDisplayStatus(statusValue),
  }));

  const priorityOptions = TASK_PRIORITY_VALUES.map((priorityValue) => ({
    value: priorityValue,
    label: formatTaskToken(priorityValue),
  }));

  const projectOptionsForCell = projectOptions.map((project) => ({
    value: project.id,
    label: project.name,
  }));

  const cellContent: Record<TaskTableColumnId, ReactNode> = {
    task: (
      <div className="row-main">
        <div className="flex min-w-0 items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Select ${task.title}`}
          />
          {titleLink}
          {task.description ? (
            <span className="max-[761px]:hidden min-w-0 flex-1 truncate text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
              {task.description}
            </span>
          ) : null}
          {hasEstimate ? (
            <EstimateVsActualBadge
              estimateMinutes={estimateMinutes}
              trackedSeconds={trackedValue ?? 0}
              className="max-[761px]:hidden"
            />
          ) : null}
          {subtaskCount && subtaskCount.total > 0 ? (
            <Badge
              tone="muted"
              aria-label={`${subtaskCount.done} of ${subtaskCount.total} subtasks done`}
            >
              ☑ {subtaskCount.done}/{subtaskCount.total}
            </Badge>
          ) : null}
          {isPinned ? <Badge tone="info">Pinned #{task.focus_rank}</Badge> : null}
          {archived ? <Badge tone="muted">Archived</Badge> : null}
        </div>

        <TaskContextLine projectName={projectName} goalTitle={goalTitle} />

        {task.description ? (
          <span className="line-clamp-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] min-[761px]:hidden">
            {task.description}
          </span>
        ) : null}
        <div
          className="mt-1.5 flex flex-col gap-1.5 min-[761px]:hidden"
          data-testid={`task-phone-meta-${task.id}`}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={status} label={formatDisplayStatus(status)} />
            <Badge tone={priority === "urgent" || priority === "high" ? "warn" : "muted"}>
              {formatTaskToken(priority)}
            </Badge>
            {hasEstimate ? (
              <EstimateVsActualBadge
                estimateMinutes={estimateMinutes}
                trackedSeconds={trackedValue ?? 0}
              />
            ) : null}
            <TaskDueDateLabel dueDate={dueDate} status={status} />
          </div>
          {status === "blocked" && task.blocked_reason?.trim() ? (
            <p className="line-clamp-2 rounded-[var(--radius-xs)] border border-[var(--status-overdue-border)] bg-[var(--status-overdue-bg)] px-2 py-1 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]">
              Blocked: {task.blocked_reason.trim()}
            </p>
          ) : null}
        </div>
      </div>
    ),
    project: (
      <SelectCell
        label="Project"
        value={projectId}
        options={projectOptionsForCell}
        fallbackLabel={projectName ?? "—"}
        taskTitle={task.title}
        testId={`task-project-cell-${task.id}`}
        pending={pendingField === "project"}
        error={fieldErrors.project}
        onSave={(value) => saveField("project", value)}
      />
    ),
    priority: (
      <SelectCell
        label="Priority"
        value={priority}
        options={priorityOptions}
        fallbackLabel={formatTaskToken(priority)}
        taskTitle={task.title}
        testId={`task-priority-cell-${task.id}`}
        pending={pendingField === "priority"}
        error={fieldErrors.priority}
        onSave={(value) => saveField("priority", value)}
      />
    ),
    due: (
      <InlineValueCell
        label="Due date"
        type="date"
        value={dueDate ?? ""}
        display={<TaskDueCell dueDate={dueDate} status={status} />}
        taskTitle={task.title}
        testId={`task-due-cell-${task.id}`}
        pending={pendingField === "dueDate"}
        error={fieldErrors.dueDate}
        onSave={(value) => saveField("dueDate", value)}
      />
    ),
    status: (
      <SelectCell
        label="Status"
        value={status}
        options={statusOptions}
        fallbackLabel={formatDisplayStatus(status)}
        taskTitle={task.title}
        testId={`task-status-cell-${task.id}`}
        pending={pendingField === "status"}
        error={fieldErrors.status}
        onSave={(value) => saveField("status", value)}
      />
    ),
    estimate: (
      <InlineValueCell
        label="Estimate minutes"
        type="number"
        inputMode="numeric"
        min={0}
        step={15}
        value={estimateMinutes === null ? "" : String(estimateMinutes)}
        display={
          estimateMinutes === null ? (
            <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">—</span>
          ) : (
            <span className="text-[length:var(--text-meta)]">{formatDisplayEstimate(estimateMinutes)}</span>
          )
        }
        taskTitle={task.title}
        testId={`task-estimate-cell-${task.id}`}
        pending={pendingField === "estimateMinutes"}
        error={fieldErrors.estimateMinutes}
        onSave={(value) => saveField("estimateMinutes", value)}
      />
    ),
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <tr
          id={`task-${task.id}`}
          data-row-done={done || undefined}
          data-row-archived={archived || undefined}
          tabIndex={0}
          aria-selected={selected}
          onKeyDown={(event) => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              event.currentTarget.dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,
                  clientX: rect.left + Math.min(rect.width / 2, 240),
                  clientY: rect.top + rect.height / 2,
                }),
              );
            }
          }}
          className="scroll-mt-24 focus-visible:outline-[var(--ega-focus-outline)] focus-visible:outline-offset-[-2px] max-[761px]:flex max-[761px]:flex-col max-[761px]:gap-2.5 max-[761px]:border-b max-[761px]:border-[var(--ega-divider)] max-[761px]:px-3.5 max-[761px]:py-3 max-[761px]:last:border-b-0"
        >
          {visibleColumns.map((column) => (
            <td
              key={column.id}
              style={column.id === "task" ? undefined : { width: column.width }}
              className={
                column.id === "task"
                  ? "max-[761px]:contents"
                  : "max-[761px]:hidden"
              }
            >
              {cellContent[column.id]}
            </td>
          ))}
          <td className="max-[761px]:contents">
            <div className="flex items-center justify-end gap-1.5 max-[761px]:justify-start">
              {rowActions}
            </div>
          </td>
        </tr>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-[80] min-w-[12rem] rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface)] p-1 text-sm shadow-[var(--ega-shadow-md)]"
          aria-label={`Actions for ${task.title}`}
        >
          <ContextMenu.Item asChild>
            <Link
              href={drawerHref}
              scroll={false}
              className="flex cursor-default select-none items-center rounded-[var(--radius-sm)] px-2 py-1.5 outline-none data-[highlighted]:bg-[var(--ega-surface-hover)]"
            >
              Open details
            </Link>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="flex cursor-default select-none items-center rounded-[var(--radius-sm)] px-2 py-1.5 outline-none data-[highlighted]:bg-[var(--ega-surface-hover)]"
            onSelect={() => {
              const url = new URL(drawerHref, window.location.origin).toString();
              void navigator.clipboard?.writeText(url).catch(() => {
                // Clipboard may be unavailable (permissions/insecure context).
              });
            }}
          >
            Copy link
          </ContextMenu.Item>
          <ContextMenu.Item
            className="flex cursor-default select-none items-center rounded-[var(--radius-sm)] px-2 py-1.5 outline-none data-[highlighted]:bg-[var(--ega-surface-hover)]"
            onSelect={onToggleSelected}
          >
            {selected ? "Deselect" : "Select"}
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-[var(--ega-divider)]" />
          <ContextMenu.Item asChild>
            <form action={archived ? actions.unarchiveAction : actions.archiveAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button
                type="submit"
                className="flex w-full cursor-default select-none items-center rounded-[var(--radius-sm)] px-2 py-1.5 text-left outline-none data-[highlighted]:bg-[var(--ega-surface-hover)]"
              >
                {archived ? "Restore" : "Archive"}
              </button>
            </form>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function SelectCell({
  label,
  value,
  options,
  fallbackLabel,
  taskTitle,
  testId,
  pending,
  error,
  onSave,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  fallbackLabel: string;
  taskTitle: string;
  testId: string;
  pending: boolean;
  error?: string;
  onSave: (value: string) => Promise<RowSaveResult>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const hasValue = options.some((option) => option.value === value);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <select
        data-testid={testId}
        aria-label={`Edit ${label} for ${taskTitle}`}
        value={shown}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          void onSave(next).then((result) => {
            if (!result.errorMessage) setDraft(null);
          });
        }}
        className="input-instrument h-7 w-full px-1.5 text-[length:var(--text-meta)]"
      >
        {hasValue ? null : <option value={value}>{fallbackLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {pending ? (
        <span role="status" className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          Saving…
        </span>
      ) : null}
      {error ? (
        <span
          role="alert"
          data-testid={`${testId}-error`}
          className="text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-[color:var(--status-overdue)]"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

function InlineValueCell({
  label,
  type,
  value,
  display,
  taskTitle,
  testId,
  pending,
  error,
  min,
  step,
  inputMode,
  onSave,
}: {
  label: string;
  type: "date" | "number";
  value: string;
  display: ReactNode;
  taskTitle: string;
  testId: string;
  pending: boolean;
  error?: string;
  min?: number;
  step?: number;
  inputMode?: "numeric";
  onSave: (value: string) => Promise<RowSaveResult>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const errorId = `${testId}-editor-error`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`${testId}-trigger`}
          aria-label={`Edit ${label} for ${taskTitle}`}
          className="inline-flex min-h-7 w-full min-w-0 items-center rounded-[var(--radius-sm)] px-1.5 text-left outline-none hover:bg-[var(--ega-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
        >
          <span className="min-w-0 truncate">{display}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label={`Edit ${label}`}
        className="w-64 p-2"
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(draft).then((result) => {
              if (!result.errorMessage) setOpen(false);
            });
          }}
        >
          <label className="text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text-secondary)]">
            {label}
            <input
              autoFocus
              type={type}
              value={draft}
              min={min}
              step={step}
              inputMode={inputMode}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              className="input-instrument mt-1 min-h-9 w-full px-2 py-1 text-sm"
            />
          </label>
          {error ? (
            <p
              id={errorId}
              role="alert"
              className="text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-[color:var(--status-overdue)]"
            >
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            {type === "date" && draft ? (
              <button
                type="button"
                onClick={() => setDraft("")}
                className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)]"
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-[var(--radius-sm)] bg-[var(--ega-ink)] px-2.5 py-1 text-[length:var(--text-meta)] font-medium text-[color:var(--ega-surface)] disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
