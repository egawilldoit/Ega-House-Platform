"use client";

import { useState, useTransition, type DragEvent } from "react";

import type { CalendarDay, TaskCalendarProjection } from "@/lib/task-calendar";
import { cn } from "@/lib/utils";

import {
  CALENDAR_DRAG_MIME,
  CalendarMorePopover,
  CalendarTaskChip,
  CalendarTimedBlock,
  readCalendarDragPayload,
  type CalendarRescheduleAction,
} from "./calendar-items";
import { CalendarLegend, CalendarToolbar, type CalendarNavigation } from "./calendar-toolbar";

const MINUTE_HEIGHT = 0.8;

function formatDayHeader(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function formatDayLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

export function TaskCalendarWeek({
  data,
  navigation,
  returnTo,
  rescheduleAction,
}: {
  data: TaskCalendarProjection;
  navigation: CalendarNavigation;
  returnTo: string;
  rescheduleAction: CalendarRescheduleAction;
}) {
  const [isPending, startTransition] = useTransition();
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const maxDayMinutes = Math.max(
    1440,
    ...data.days.map((day) => day.durationMinutes),
  );
  const gridHeight = maxDayMinutes * MINUTE_HEIGHT;
  const totalItems = data.days.reduce(
    (count, day) => count + day.tasks.length + day.timed.length,
    0,
  );

  function submitDrop(payload: ReturnType<typeof readCalendarDragPayload>, date: string) {
    if (!payload || isPending) return;
    const formData = new FormData();
    formData.set("taskId", payload.taskId);
    formData.set("mode", payload.kind === "scheduled" ? "schedule" : "date");
    if (payload.kind === "date") {
      formData.set("field", payload.dateField);
    } else {
      formData.set("time", payload.startTime);
    }
    formData.set("date", date);
    formData.set("expectedUpdatedAt", payload.expectedUpdatedAt);
    formData.set("returnTo", returnTo);
    startTransition(() => {
      void rescheduleAction(formData);
    });
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, date: string) {
    if (!event.dataTransfer.types.includes(CALENDAR_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverDate !== date) setDragOverDate(date);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, date: string) {
    event.preventDefault();
    setDragOverDate(null);
    submitDrop(readCalendarDragPayload(event), date);
  }

  function dayDropProps(day: CalendarDay) {
    return {
      onDragOver: (event: DragEvent<HTMLDivElement>) => handleDragOver(event, day.date),
      onDragLeave: (event: DragEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragOverDate((current) => (current === day.date ? null : current));
        }
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => handleDrop(event, day.date),
    };
  }

  return (
    <div className="task-calendar" data-view="week" aria-busy={isPending}>
      <CalendarToolbar data={data} navigation={navigation} />

      {isPending ? (
        <p className="calendar-notice" role="status">
          Saving reschedule…
        </p>
      ) : null}

      {data.truncated ? (
        <p className="calendar-notice" role="status">
          This range has more items than one calendar page can show. Narrow the filters to see the
          rest.
        </p>
      ) : null}

      {totalItems === 0 ? (
        <p className="calendar-empty">
          Nothing scheduled in this range. Drag a task onto a day, or use a task menu to move it.
        </p>
      ) : null}

      <div className="calendar-week-scroll">
      <div
        role="grid"
        aria-label={`${data.rangeLabel} week calendar, ${data.dateField === "planned" ? "planned" : "due"} dates`}
        className="calendar-week"
      >
        <div role="row" className="calendar-week-row calendar-week-header">
          <div role="columnheader" className="calendar-week-hour-heading">
            Time
          </div>
          {data.days.map((day) => (
            <div
              key={`head-${day.date}`}
              role="columnheader"
              className={cn("calendar-week-day-heading", day.isToday && "calendar-day-today")}
            >
              <span>{formatDayHeader(day.date)}</span>
              {day.isToday ? <span className="calendar-today-label">Today</span> : null}
            </div>
          ))}
        </div>

        <div role="row" className="calendar-week-row calendar-week-task-row">
          <div role="gridcell" className="calendar-week-hour-heading">
            <span className="sr-only">Tasks on their selected date</span>
          </div>
          {data.days.map((day) => {
            const hiddenCount = Math.max(0, day.tasks.length - 3);
            return (
              <div
                key={`tasks-${day.date}`}
                role="gridcell"
                className={cn(
                  "calendar-week-task-cell",
                  day.isToday && "calendar-day-today",
                  dragOverDate === day.date && "calendar-day-dragover",
                )}
                {...dayDropProps(day)}
              >
                {day.tasks.slice(0, 3).map((item) => (
                  <CalendarTaskChip
                    key={`${item.id}-${item.dateField}`}
                    item={item}
                    returnTo={returnTo}
                    rescheduleAction={rescheduleAction}
                    compact
                  />
                ))}
                {hiddenCount > 0 ? (
                  <CalendarMorePopover count={hiddenCount} label={formatDayLabel(day.date)}>
                    <ul className="calendar-more-list">
                      {day.tasks.slice(3).map((item) => (
                        <li key={`${item.id}-more`}>
                          <CalendarTaskChip
                            item={item}
                            returnTo={returnTo}
                            rescheduleAction={rescheduleAction}
                            compact
                          />
                        </li>
                      ))}
                    </ul>
                  </CalendarMorePopover>
                ) : null}
                {day.tasks.length === 0 ? (
                  <span className="calendar-week-empty">No tasks</span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div role="row" className="calendar-week-row calendar-week-body">
          <div
            role="gridcell"
            className="calendar-week-hours"
            style={{ height: gridHeight }}
            aria-hidden="true"
          >
            {Array.from({ length: Math.floor(maxDayMinutes / 60) + 1 }, (_, hour) => (
              <span
                key={`hour-${hour}`}
                className="calendar-hour-label"
                style={{ top: hour * 60 * MINUTE_HEIGHT }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>

          {data.days.map((day) => (
            <div
              key={`body-${day.date}`}
              role="gridcell"
              className={cn(
                "calendar-week-column",
                day.isToday && "calendar-day-today",
                dragOverDate === day.date && "calendar-day-dragover",
              )}
              style={{ height: gridHeight }}
              aria-label={`${formatDayLabel(day.date)}. ${day.tasks.length} tasks, ${
                day.timed.length
              } timed items.`}
              {...dayDropProps(day)}
            >
              {day.timed.map((item) => (
                <CalendarTimedBlock
                  key={item.id}
                  item={item}
                  returnTo={returnTo}
                  rescheduleAction={rescheduleAction}
                  style={{
                    top: item.startMinute * MINUTE_HEIGHT,
                    height: Math.max(22, (item.endMinute - item.startMinute) * MINUTE_HEIGHT),
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      </div>

      <CalendarLegend />
    </div>
  );
}
