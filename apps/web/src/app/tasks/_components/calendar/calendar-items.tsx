"use client";

import Link from "next/link";
import type { CSSProperties, DragEvent, ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildTaskDrawerLink } from "@/lib/task-drawer-url";
import type {
  CalendarTaskItem,
  CalendarTimedItem,
} from "@/lib/task-calendar";
import { cn } from "@/lib/utils";

export const CALENDAR_DRAG_MIME = "application/x-ega-calendar";

export type CalendarDragPayload =
  | {
      kind: "date";
      taskId: string;
      dateField: CalendarTaskItem["dateField"];
      expectedUpdatedAt: string;
    }
  | {
      kind: "scheduled";
      taskId: string;
      expectedUpdatedAt: string;
      startTime: string;
    };

export type CalendarRescheduleAction = (formData: FormData) => void | Promise<void>;

function dateFieldLabel(dateField: CalendarTaskItem["dateField"]) {
  return dateField === "planned" ? "planned" : "due";
}

function writeDragPayload(event: DragEvent<HTMLElement>, payload: CalendarDragPayload) {
  event.dataTransfer.setData(CALENDAR_DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.setData("text/plain", payload.taskId);
  event.dataTransfer.effectAllowed = "move";
}

export function readCalendarDragPayload(event: DragEvent<HTMLElement>) {
  const raw = event.dataTransfer.getData(CALENDAR_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CalendarDragPayload>;
    if (
      (parsed.kind === "date" || parsed.kind === "scheduled") &&
      typeof parsed.taskId === "string" &&
      parsed.taskId
    ) {
      return parsed as CalendarDragPayload;
    }
  } catch {
    return null;
  }
  return null;
}

export function CalendarTaskChip({
  item,
  returnTo,
  rescheduleAction,
  compact = false,
}: {
  item: CalendarTaskItem;
  returnTo: string;
  rescheduleAction: CalendarRescheduleAction;
  compact?: boolean;
}) {
  const label = dateFieldLabel(item.dateField);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          draggable
          onDragStart={(event) =>
            writeDragPayload(event, {
              kind: "date",
              taskId: item.id,
              dateField: item.dateField,
              expectedUpdatedAt: item.updatedAt,
            })
          }
          className={cn(
            "calendar-chip",
            `calendar-chip-status-${item.status}`,
            compact && "calendar-chip-compact",
          )}
          title={item.title}
          aria-label={`${item.title}. ${label} date ${item.date}. Open move menu`}
        >
          <span className="calendar-chip-title">{item.title}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="calendar-popover">
          <p className="calendar-popover-title">{item.title}</p>
          <p className="calendar-popover-meta">
            {item.projectName ?? "No project"} · {label} date
          </p>
          <form action={rescheduleAction} className="calendar-popover-form">
            <input type="hidden" name="taskId" value={item.id} />
            <input type="hidden" name="mode" value="date" />
            <input type="hidden" name="field" value={item.dateField} />
            <input type="hidden" name="expectedUpdatedAt" value={item.updatedAt} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="calendar-popover-label" htmlFor={`move-${item.id}-${item.date}`}>
              New {label} date
            </label>
            <input
              id={`move-${item.id}-${item.date}`}
              type="date"
              name="date"
              defaultValue={item.date}
              required
              className="calendar-popover-input"
            />
            <button type="submit" className="calendar-popover-submit">
              Move task
            </button>
          </form>
          <Link
            href={buildTaskDrawerLink(returnTo, item.id)}
            className="calendar-popover-link"
          >
            Open task
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CalendarTimedBlock({
  item,
  returnTo,
  rescheduleAction,
  style,
}: {
  item: CalendarTimedItem;
  returnTo: string;
  rescheduleAction: CalendarRescheduleAction;
  style: CSSProperties;
}) {
  const timeLabel = `${item.startLabel}–${item.endLabel}`;

  if (item.readOnly) {
    return (
      <div
        className="calendar-timed calendar-timed-session"
        style={style}
        aria-label={`Timer session for ${item.title}, ${timeLabel}. Read-only.`}
        title={`Timer session · ${item.title} · ${timeLabel}`}
      >
        <span className="calendar-timed-badge">Timer</span>
        <span className="calendar-timed-title">{item.title}</span>
        <span className="calendar-timed-time">{timeLabel}</span>
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          draggable
          onDragStart={(event) =>
            writeDragPayload(event, {
              kind: "scheduled",
              taskId: item.taskId,
              expectedUpdatedAt: item.updatedAt,
              startTime: item.startLabel,
            })
          }
          className="calendar-timed calendar-timed-scheduled"
          style={style}
          aria-label={`${item.title}, scheduled ${timeLabel}. Open move menu`}
          title={`${item.title} · ${timeLabel}`}
        >
          <span className="calendar-timed-title">{item.title}</span>
          <span className="calendar-timed-time">{timeLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="calendar-popover">
          <p className="calendar-popover-title">{item.title}</p>
          <p className="calendar-popover-meta">Scheduled block · {timeLabel}</p>
          <form action={rescheduleAction} className="calendar-popover-form">
            <input type="hidden" name="taskId" value={item.taskId} />
            <input type="hidden" name="mode" value="schedule" />
            <input type="hidden" name="expectedUpdatedAt" value={item.updatedAt} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="calendar-popover-label" htmlFor={`move-block-${item.id}`}>
              New day
            </label>
            <input
              id={`move-block-${item.id}`}
              type="date"
              name="date"
              defaultValue={item.date}
              required
              className="calendar-popover-input"
            />
            <label className="calendar-popover-label" htmlFor={`move-block-time-${item.id}`}>
              Start time
            </label>
            <input
              id={`move-block-time-${item.id}`}
              type="time"
              name="time"
              defaultValue={item.startLabel}
              required
              className="calendar-popover-input"
            />
            <button type="submit" className="calendar-popover-submit">
              Move block
            </button>
          </form>
          <Link
            href={buildTaskDrawerLink(returnTo, item.taskId)}
            className="calendar-popover-link"
          >
            Open task
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CalendarMorePopover({
  count,
  label,
  children,
}: {
  count: number;
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="calendar-more"
          aria-label={`${label}. Show ${count} more task${count === 1 ? "" : "s"}`}
        >
          +{count} more
        </button>
      </PopoverTrigger>
      <PopoverContent className="calendar-more-content">
        <p className="calendar-popover-title">{label}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}
