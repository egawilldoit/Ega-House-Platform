"use client";

import { useState, useTransition, type DragEvent } from "react";

import type { CalendarDay, TaskCalendarProjection } from "@/lib/task-calendar";
import { cn } from "@/lib/utils";

import {
  CALENDAR_DRAG_MIME,
  CalendarMorePopover,
  CalendarTaskChip,
  readCalendarDragPayload,
  type CalendarRescheduleAction,
} from "./calendar-items";
import { CalendarLegend, CalendarToolbar, type CalendarNavigation } from "./calendar-toolbar";

function formatDayLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function groupIntoWeeks(days: CalendarDay[]) {
  const weeks: CalendarDay[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }
  return weeks;
}

export function TaskCalendarMonth({
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

  const weeks = groupIntoWeeks(data.days);
  const totalItems = data.days.reduce(
    (count, day) => count + day.tasks.length + day.timed.length,
    0,
  );

  return (
    <div className="task-calendar" data-view="month" aria-busy={isPending}>
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

      <div
        role="grid"
        aria-label={`${data.rangeLabel} calendar, ${data.dateField === "planned" ? "planned" : "due"} dates`}
        className="calendar-month"
      >
        <div role="row" className="calendar-month-weekdays">
          {data.weekdayLabels.map((label) => (
            <div key={label} role="columnheader" className="calendar-weekday" aria-label={label}>
              {label}
            </div>
          ))}
        </div>

        {weeks.map((week) => (
          <div role="row" key={week[0]?.date ?? "week"} className="calendar-month-row">
            {week.map((day) => {
              const label = formatDayLabel(day.date);
              const hiddenCount = Math.max(0, day.tasks.length - 3);
              return (
                <div
                  key={day.date}
                  role="gridcell"
                  className={cn(
                    "calendar-day",
                    day.isOutsideMonth && "calendar-day-outside",
                    day.isToday && "calendar-day-today",
                    dragOverDate === day.date && "calendar-day-dragover",
                  )}
                  aria-label={`${label}. ${day.tasks.length} task${
                    day.tasks.length === 1 ? "" : "s"
                  }, ${day.timed.length} timed item${day.timed.length === 1 ? "" : "s"}.`}
                  onDragOver={(event) => handleDragOver(event, day.date)}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDragOverDate((current) => (current === day.date ? null : current));
                    }
                  }}
                  onDrop={(event) => handleDrop(event, day.date)}
                >
                  <div className="calendar-day-header">
                    <time dateTime={day.date}>{day.dayOfMonth}</time>
                    {day.isToday ? <span className="calendar-today-label">Today</span> : null}
                  </div>

                  <div className="calendar-day-items">
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
                      <CalendarMorePopover count={hiddenCount} label={label}>
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
                    {day.timed.length > 0 ? (
                      <p className="calendar-day-timed-count">
                        {day.timed.length} timed
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <CalendarLegend />
    </div>
  );
}
