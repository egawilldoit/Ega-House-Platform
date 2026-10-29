"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { shiftDateOnlyValue } from "@/lib/task-due-date";
import {
  getTimelineDayWidth,
  type TimelineModel,
  type TimelineRange,
  type TimelineRow,
  type TimelineZoom,
} from "@/lib/task-timeline";

import { DependencyArrows } from "./dependency-arrows";
import { TimelineBar, type TimelineCommitInput } from "./timeline-bar";
import styles from "./timeline.module.css";

const ROW_HEIGHT = 44;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type TimelineScheduleActionState = {
  errorMessage: string | null;
  successMessage: string | null;
  taskId: string | null;
};

export type TimelineScheduleAction = (
  state: TimelineScheduleActionState,
  formData: FormData,
) => Promise<TimelineScheduleActionState>;

type TaskTimelineProps = Readonly<{
  model: TimelineModel;
  range: TimelineRange;
  zoom: TimelineZoom;
  today: string;
  returnTo: string;
  action: TimelineScheduleAction;
}>;

function weekdayIndex(isoDate: string) {
  return new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
}

function weekdayLabel(isoDate: string) {
  const index = weekdayIndex(isoDate);
  return WEEKDAY_LABELS[index] ?? "?";
}

function monthLabel(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00.000Z`));
}

function dateLabel(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00.000Z`));
}

function taskHref(base: string, taskId: string) {
  const params = new URLSearchParams(base.split("?")[1] ?? "");
  params.set("task", taskId);
  const query = params.toString();
  return query ? `${base.split("?")[0]}?${query}` : `${base}?task=${taskId}`;
}

function initialDates(task: TimelineRow["task"]) {
  return {
    startDate: task.start_date ?? "",
    dueDate: task.due_date ?? "",
  };
}

export function TaskTimeline({
  model,
  range,
  zoom,
  today,
  returnTo,
  action,
}: TaskTimelineProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const dayWidth = getTimelineDayWidth(zoom);
  const canvasWidth = range.days.length * dayWidth;

  const allTasksById = useMemo(
    () => new Map([...model.scheduledRows, ...model.unscheduledRows].map((row) => [row.task.id, row])),
    [model],
  );
  const selectedRow = selectedTaskId ? allTasksById.get(selectedTaskId) ?? null : null;

  function navigate(overrides: { tlStart?: string; tlZoom?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("layout", "timeline");
    params.delete("task");
    params.delete("taskMode");
    if (overrides.tlStart) params.set("tlStart", overrides.tlStart);
    else params.delete("tlStart");
    if (overrides.tlZoom) params.set("tlZoom", overrides.tlZoom);
    else params.delete("tlZoom");
    return `${pathname}?${params.toString()}`;
  }

  async function commit(input: TimelineCommitInput) {
    setPendingTaskId(input.taskId);
    setError(null);
    setSuccess(null);
    const formData = new FormData();
    formData.set("taskId", input.taskId);
    formData.set("startDate", input.startDate);
    formData.set("dueDate", input.dueDate);
    formData.set("expectedUpdatedAt", input.expectedUpdatedAt);
    formData.set("returnTo", returnTo);
    try {
      const result = await action(
        { errorMessage: null, successMessage: null, taskId: input.taskId },
        formData,
      );
      if (result.errorMessage) {
        setError(result.errorMessage);
        return false;
      }
      setSuccess(result.successMessage ?? "Dates updated.");
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError("Unable to save the new dates right now. Try again.");
      return false;
    } finally {
      setPendingTaskId(null);
    }
  }

  const todayOffset = range.days.indexOf(today);
  const todayX = todayOffset >= 0 ? todayOffset * dayWidth + dayWidth / 2 : null;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup} role="group" aria-label="Timeline window">
          <Link className={styles.navLink} href={navigate({ tlStart: shiftDateOnlyValue(range.start, -28) })}>
            Previous
          </Link>
          <Link
            className={styles.navLink}
            href={navigate({ tlStart: shiftDateOnlyValue(today, -14) })}
            aria-current={range.days.includes(today) ? "true" : undefined}
          >
            Today
          </Link>
          <Link className={styles.navLink} href={navigate({ tlStart: shiftDateOnlyValue(range.start, 28) })}>
            Next
          </Link>
        </div>
        <div className={styles.toolbarGroup} role="group" aria-label="Timeline zoom">
          <Link
            className={styles.navLink}
            href={navigate({ tlZoom: "week" })}
            aria-current={zoom === "week" ? "true" : undefined}
          >
            Week
          </Link>
          <Link
            className={styles.navLink}
            href={navigate({ tlZoom: "month" })}
            aria-current={zoom === "month" ? "true" : undefined}
          >
            Month
          </Link>
        </div>
        <p className={styles.toolbarLabel}>
          {dateLabel(range.start)} – {dateLabel(range.end)} · {model.scheduledRows.length} bar
          {model.scheduledRows.length === 1 ? "" : "s"} · {model.unscheduledRows.length} unscheduled
        </p>
      </div>

      {selectedRow ? (
        <TimelineDateEditor
          key={selectedRow.task.id}
          row={selectedRow}
          returnTo={returnTo}
          pending={pendingTaskId === selectedRow.task.id}
          onCommit={commit}
          onClose={() => setSelectedTaskId(null)}
          onError={setError}
        />
      ) : null}

      {error ? (
        <p className={styles.feedbackError} role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className={styles.feedbackSuccess} role="status">
          {success}
        </p>
      ) : null}

      {model.scheduledRows.length === 0 ? (
        <p className={styles.empty}>
          No tasks have both a start date and a due date in this window. Add both dates
          below or move to another window.
        </p>
      ) : (
        <div className={styles.viewport}>
          <div className={styles.grid}>
            <div className={styles.headerCell}>Task</div>
            <div className={styles.dayHeader}>
              {range.days.map((day) => {
                const dayOfWeek = weekdayIndex(day);
                return (
                  <div
                    key={day}
                    className={`${styles.dayCell} ${day === today ? styles.dayToday : ""}`}
                    style={{ width: dayWidth }}
                    data-weekend={dayOfWeek === 0 || dayOfWeek === 6 ? "true" : "false"}
                    data-month-start={day.endsWith("-01") ? "true" : "false"}
                    title={`${weekdayLabel(day)} ${dateLabel(day)}`}
                  >
                    {day.endsWith("-01") ? <div>{monthLabel(day)}</div> : null}
                    <div>{dayOfWeek === 1 || day === range.days[0] ? weekdayLabel(day) : ""}</div>
                    <div>{Number(day.slice(8, 10))}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.body}>
            <div className={styles.canvasOverlay} style={{ width: canvasWidth }}>
              {todayX !== null ? (
                <div className={styles.todayLine} style={{ left: todayX }} aria-hidden="true">
                  <span className={styles.todayFlag}>Today</span>
                </div>
              ) : null}
              <DependencyArrows
                arrows={model.arrows}
                dayWidth={dayWidth}
                rowHeight={ROW_HEIGHT}
                rowCount={model.scheduledRows.length}
                width={canvasWidth}
              />
            </div>
            {model.scheduledRows.map((row, index) => (
              <TimelineRowView
                key={row.task.id}
                row={row}
                index={index}
                dayWidth={dayWidth}
                range={range}
                returnTo={returnTo}
                pending={pendingTaskId === row.task.id}
                selected={selectedTaskId === row.task.id}
                hiddenDependencyCount={model.hiddenDependencyCountByTask[row.task.id] ?? 0}
                onCommit={commit}
                onSelect={(taskId) => {
                  setSelectedTaskId(taskId);
                  setError(null);
                  setSuccess(null);
                }}
              />
            ))}
          </div>
        </div>
      )}

      <section className={styles.section} aria-labelledby="timeline-unscheduled-heading">
        <h3 id="timeline-unscheduled-heading" className={styles.sectionTitle}>
          Unscheduled
        </h3>
        <p className={styles.listMeta}>
          Tasks without both a start and due date stay here. No date is invented and
          no bar is drawn.
        </p>
        {model.unscheduledRows.length === 0 ? (
          <p className={styles.listMeta}>None in this window.</p>
        ) : (
          <ul className={styles.list}>
            {model.unscheduledRows.map((row) => (
              <li key={row.task.id} className={styles.listItem}>
                <Link className={styles.listLink} href={taskHref(returnTo, row.task.id)}>
                  {row.task.title}
                </Link>
                <span className={styles.listMeta}>
                  {row.task.start_date ? `Start ${dateLabel(row.task.start_date)}` : "No start"}
                  {" · "}
                  {row.task.due_date ? `Due ${dateLabel(row.task.due_date)}` : "No due date"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className={styles.section}>
        <summary className={styles.sectionTitle}>
          Dependency list ({model.dependencyLines.length})
        </summary>
        <p className={styles.listMeta}>
          Text equivalent of the arrows. Edges are informational and never change
          status or dates.
        </p>
        {model.dependencyLines.length === 0 ? (
          <p className={styles.listMeta}>No dependencies touch this window.</p>
        ) : (
          <ul className={styles.list}>
            {model.dependencyLines.map((line, index) => (
              <li key={`${line}-${index}`} className={styles.listItem}>
                {line}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function TimelineRowView({
  row,
  index,
  dayWidth,
  range,
  returnTo,
  pending,
  selected,
  hiddenDependencyCount,
  onCommit,
  onSelect,
}: {
  row: TimelineRow;
  index: number;
  dayWidth: number;
  range: TimelineRange;
  returnTo: string;
  pending: boolean;
  selected: boolean;
  hiddenDependencyCount: number;
  onCommit: (input: TimelineCommitInput) => Promise<boolean>;
  onSelect: (taskId: string) => void;
}) {
  if (!row.bar) return null;

  return (
    <div className={styles.row} data-row-index={index}>
      <div className={styles.rowLabel}>
        <Link className={styles.rowTitle} href={taskHref(returnTo, row.task.id)}>
          {row.task.title}
        </Link>
        <span className={styles.rowMeta}>
          {row.task.projectName ? `${row.task.projectName} · ` : ""}
          {dateLabel(row.bar.startDate)} – {dateLabel(row.bar.dueDate)}
          {hiddenDependencyCount > 0 ? (
            <>
              {" "}
              <span className={styles.hiddenBadge}>
                {hiddenDependencyCount} hidden blocked-by
              </span>
            </>
          ) : null}
        </span>
      </div>
      <div className={styles.track}>
        {range.days.map((day) => {
          const dayOfWeek = weekdayIndex(day);
          if (dayOfWeek !== 0 && dayOfWeek !== 6) return null;
          const offset = range.days.indexOf(day);
          return (
            <span
              key={day}
              className={styles.weekendShade}
              style={{ left: offset * dayWidth, width: dayWidth }}
              aria-hidden="true"
            />
          );
        })}
        <TimelineBar
          row={row as TimelineRow & { bar: NonNullable<TimelineRow["bar"]> }}
          rangeStart={range.start}
          rangeDayCount={range.days.length}
          dayWidth={dayWidth}
          selected={selected}
          pending={pending}
          onCommit={(input) => {
            void onCommit(input);
          }}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

function TimelineDateEditor({
  row,
  returnTo,
  pending,
  onCommit,
  onClose,
  onError,
}: {
  row: TimelineRow;
  returnTo: string;
  pending: boolean;
  onCommit: (input: TimelineCommitInput) => Promise<boolean>;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const [startDate, setStartDate] = useState(initialDates(row.task).startDate);
  const [dueDate, setDueDate] = useState(initialDates(row.task).dueDate);
  const current = initialDates(row.task);
  const changed = startDate !== current.startDate || dueDate !== current.dueDate;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    const saved = await onCommit({
      taskId: row.task.id,
      startDate,
      dueDate,
      expectedUpdatedAt: row.task.updatedAt ?? "",
    });
    if (saved) onClose();
  }

  return (
    <form className={styles.editor} onSubmit={(event) => void submit(event)}>
      <p className={styles.sectionTitle}>
        Edit dates for <span className={styles.rowTitle}>{row.task.title}</span>
      </p>
      <label className={styles.editorField}>
        Start date
        <input
          className={styles.editorInput}
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
      </label>
      <label className={styles.editorField}>
        Due date
        <input
          className={styles.editorInput}
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
      </label>
      <div className={styles.editorActions}>
        <Button type="submit" size="sm" variant="secondary" disabled={!changed || pending}>
          {pending ? "Saving…" : "Save dates"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Link className={styles.listLink} href={taskHref(returnTo, row.task.id)}>
          More fields
        </Link>
      </div>
    </form>
  );
}
