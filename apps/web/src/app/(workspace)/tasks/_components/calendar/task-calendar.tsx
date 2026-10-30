"use client";

import type { TaskCalendarProjection } from "@/lib/task-calendar";

import type { CalendarRescheduleAction } from "./calendar-items";
import type { CalendarNavigation } from "./calendar-toolbar";
import { TaskCalendarMonth } from "./task-calendar-month";
import { TaskCalendarWeek } from "./task-calendar-week";

/**
 * Client boundary for the Tasks calendar. The server page owns the bounded
 * range read; this component owns only drag state, popovers and pending state.
 */
export function TaskCalendar({
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
  if (data.view === "week") {
    return (
      <TaskCalendarWeek
        data={data}
        navigation={navigation}
        returnTo={returnTo}
        rescheduleAction={rescheduleAction}
      />
    );
  }

  return (
    <TaskCalendarMonth
      data={data}
      navigation={navigation}
      returnTo={returnTo}
      rescheduleAction={rescheduleAction}
    />
  );
}
