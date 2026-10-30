"use client";

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { shiftDateOnlyValue } from "@/lib/task-due-date";
import type { TimelineBar as TimelineBarModel, TimelineRow } from "@/lib/task-timeline";
import { dayDistance } from "@/lib/task-timeline";

import styles from "./timeline.module.css";

export type TimelineCommitInput = Readonly<{
  taskId: string;
  startDate: string;
  dueDate: string;
  expectedUpdatedAt: string;
}>;

type TimelineBarProps = Readonly<{
  row: TimelineRow & { bar: TimelineBarModel };
  rangeStart: string;
  rangeDayCount: number;
  dayWidth: number;
  selected: boolean;
  pending: boolean;
  onCommit: (input: TimelineCommitInput) => void;
  onSelect: (taskId: string) => void;
}>;

type DragMode = "move" | "resize-start" | "resize-end";

type DragState = {
  mode: DragMode;
  pointerId: number;
  startX: number;
  startDate: string;
  dueDate: string;
};

type Preview = {
  startOffset: number;
  endOffset: number;
  startDate: string;
  dueDate: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampOffset(value: number, dayCount: number) {
  return clamp(value, 0, Math.max(0, dayCount - 1));
}

export function TimelineBar({
  row,
  rangeStart,
  rangeDayCount,
  dayWidth,
  selected,
  pending,
  onCommit,
  onSelect,
}: TimelineBarProps) {
  const { task, bar } = row;
  const [preview, setPreview] = useState<Preview | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const barRef = useRef<HTMLButtonElement | null>(null);

  const activeStartOffset = preview?.startOffset ?? bar.startOffset;
  const activeEndOffset = preview?.endOffset ?? bar.endOffset;
  const activeStartDate = preview?.startDate ?? bar.startDate;
  const activeDueDate = preview?.dueDate ?? bar.dueDate;
  const left = activeStartOffset * dayWidth;
  const width = Math.max(dayWidth - 2, (activeEndOffset - activeStartOffset + 1) * dayWidth - 2);

  function beginDrag(event: ReactPointerEvent<HTMLElement>, mode: DragMode) {
    if (event.button !== 0 || pending) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startDate: bar.startDate,
      dueDate: bar.dueDate,
    };
    barRef.current?.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const rawDelta = Math.round((event.clientX - drag.startX) / dayWidth);
    if (rawDelta === 0) {
      setPreview(null);
      return;
    }

    if (drag.mode === "move") {
      const minDelta = -bar.startOffset;
      const maxDelta = rangeDayCount - 1 - bar.endOffset;
      const delta = clamp(rawDelta, minDelta, maxDelta);
      setPreview({
        startOffset: bar.startOffset + delta,
        endOffset: bar.endOffset + delta,
        startDate: shiftDateOnlyValue(drag.startDate, delta),
        dueDate: shiftDateOnlyValue(drag.dueDate, delta),
      });
      return;
    }

    if (drag.mode === "resize-end") {
      const nextDue = shiftDateOnlyValue(drag.dueDate, rawDelta);
      const safeDue = nextDue < drag.startDate ? drag.startDate : nextDue;
      setPreview({
        startOffset: bar.startOffset,
        endOffset: clampOffset(dayDistance(rangeStart, safeDue), rangeDayCount),
        startDate: drag.startDate,
        dueDate: safeDue,
      });
      return;
    }

    const nextStart = shiftDateOnlyValue(drag.startDate, rawDelta);
    const safeStart = nextStart > drag.dueDate ? drag.dueDate : nextStart;
    setPreview({
      startOffset: clampOffset(dayDistance(rangeStart, safeStart), rangeDayCount),
      endOffset: bar.endOffset,
      startDate: safeStart,
      dueDate: drag.dueDate,
    });
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (barRef.current?.hasPointerCapture(event.pointerId)) {
      barRef.current.releasePointerCapture(event.pointerId);
    }

    const next = preview;
    setPreview(null);
    if (!next || (next.startDate === bar.startDate && next.dueDate === bar.dueDate)) {
      onSelect(task.id);
      return;
    }

    onCommit({
      taskId: task.id,
      startDate: next.startDate,
      dueDate: next.dueDate,
      expectedUpdatedAt: task.updatedAt ?? "",
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(task.id);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;

    if (event.shiftKey) {
      const nextDue = shiftDateOnlyValue(bar.dueDate, direction);
      const safeDue = nextDue < bar.startDate ? bar.startDate : nextDue;
      if (safeDue === bar.dueDate) return;
      onCommit({
        taskId: task.id,
        startDate: bar.startDate,
        dueDate: safeDue,
        expectedUpdatedAt: task.updatedAt ?? "",
      });
      return;
    }

    onCommit({
      taskId: task.id,
      startDate: shiftDateOnlyValue(bar.startDate, direction),
      dueDate: shiftDateOnlyValue(bar.dueDate, direction),
      expectedUpdatedAt: task.updatedAt ?? "",
    });
  }

  return (
    <button
      ref={barRef}
      type="button"
      className={styles.bar}
      style={{ left, width }}
      data-status={task.status}
      data-selected={selected ? "true" : "false"}
      data-dragging={preview ? "true" : "false"}
      data-pending={pending ? "true" : "false"}
      aria-label={`${task.title}, ${activeStartDate} to ${activeDueDate}`}
      aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"
      aria-pressed={selected}
      title={`${task.title}\n${activeStartDate} → ${activeDueDate}\nArrow keys move; Shift+Arrow resizes the due date.`}
      onPointerDown={(event) => beginDrag(event, "move")}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={handleKeyDown}
      data-testid={`timeline-bar-${task.id}`}
    >
      <span
        role="presentation"
        className={`${styles.handle} ${styles.handleStart}`}
        onPointerDown={(event) => beginDrag(event, "resize-start")}
      />
      <span className={styles.barLabel}>{task.title}</span>
      <span
        role="presentation"
        className={`${styles.handle} ${styles.handleEnd}`}
        onPointerDown={(event) => beginDrag(event, "resize-end")}
      />
      {bar.clippedStart && !preview ? (
        <span className={`${styles.clipMark} ${styles.clipStart}`} aria-hidden="true" />
      ) : null}
      {bar.clippedEnd && !preview ? (
        <span className={`${styles.clipMark} ${styles.clipEnd}`} aria-hidden="true" />
      ) : null}
    </button>
  );
}
