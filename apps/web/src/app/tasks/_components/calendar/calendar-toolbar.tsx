"use client";

import Link from "next/link";

import { FilterPill } from "@/components/ui/filter-pill";
import type { TaskCalendarProjection } from "@/lib/task-calendar";

export type CalendarNavigation = {
  prevHref: string;
  nextHref: string;
  todayHref: string;
  monthHref: string;
  weekHref: string;
  dueHref: string;
  plannedHref: string;
};

export function CalendarToolbar({
  data,
  navigation,
}: {
  data: TaskCalendarProjection;
  navigation: CalendarNavigation;
}) {
  return (
    <div className="calendar-toolbar">
      <div className="calendar-toolbar-nav">
        <Link
          href={navigation.prevHref}
          className="calendar-nav-button"
          aria-label={data.view === "month" ? "Previous month" : "Previous week"}
        >
          ←
        </Link>
        <Link href={navigation.todayHref} className="calendar-nav-button calendar-nav-today">
          Today
        </Link>
        <Link
          href={navigation.nextHref}
          className="calendar-nav-button"
          aria-label={data.view === "month" ? "Next month" : "Next week"}
        >
          →
        </Link>
        <h2 className="calendar-title">{data.rangeLabel}</h2>
      </div>

      <div className="calendar-toolbar-toggles">
        <div className="flex items-center gap-1.5" role="group" aria-label="Calendar range">
          <FilterPill
            href={navigation.monthHref}
            label="Month"
            active={data.view === "month"}
            ariaCurrent={data.view === "month" ? "page" : undefined}
          />
          <FilterPill
            href={navigation.weekHref}
            label="Week"
            active={data.view === "week"}
            ariaCurrent={data.view === "week" ? "page" : undefined}
          />
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="Calendar date field">
          <FilterPill
            href={navigation.dueHref}
            label="Due"
            active={data.dateField === "due"}
            ariaCurrent={data.dateField === "due" ? "page" : undefined}
          />
          <FilterPill
            href={navigation.plannedHref}
            label="Planned"
            active={data.dateField === "planned"}
            ariaCurrent={data.dateField === "planned" ? "page" : undefined}
          />
        </div>
      </div>
    </div>
  );
}

export function CalendarLegend() {
  return (
    <div className="calendar-legend" aria-label="Calendar legend">
      <span className="calendar-legend-item">
        <span className="calendar-legend-swatch calendar-legend-swatch-scheduled" aria-hidden="true" />
        Scheduled block
      </span>
      <span className="calendar-legend-item">
        <span className="calendar-legend-swatch calendar-legend-swatch-session" aria-hidden="true" />
        Timer session (read-only)
      </span>
      <span className="calendar-legend-item">Drag a task or block, or use its menu to move it.</span>
    </div>
  );
}
