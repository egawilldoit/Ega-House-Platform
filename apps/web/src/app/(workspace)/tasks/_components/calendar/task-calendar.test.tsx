// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

import {
  buildCalendarRange,
  buildTaskCalendarProjection,
  type CalendarProjectableTask,
} from "@/lib/task-calendar";
import type { CalendarNavigation } from "./calendar-toolbar";
import { TaskCalendarMonth } from "./task-calendar-month";
import { TaskCalendarWeek } from "./task-calendar-week";

const NAVIGATION: CalendarNavigation = {
  prevHref: "/tasks?layout=calendar&cal=week&date=2026-05-01",
  nextHref: "/tasks?layout=calendar&cal=week&date=2026-05-15",
  todayHref: "/tasks?layout=calendar&cal=week&date=2026-05-06",
  monthHref: "/tasks?layout=calendar&cal=month&date=2026-05-06",
  weekHref: "/tasks?layout=calendar&cal=week&date=2026-05-06",
  dueHref: "/tasks?layout=calendar&cal=week&date=2026-05-06",
  plannedHref: "/tasks?layout=calendar&cal=week&date=2026-05-06&dateField=planned",
};

function task(overrides: Partial<CalendarProjectableTask> = {}): CalendarProjectableTask {
  return {
    id: "task-1",
    title: "Draft weekly review",
    status: "todo",
    priority: "high",
    due_date: "2026-05-06",
    planned_for_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    updated_at: "2026-05-01T10:00:00.000Z",
    projects: { name: "EGA House" },
    ...overrides,
  };
}

function buildWeekProjection() {
  const range = buildCalendarRange({
    view: "week",
    anchorDate: "2026-05-06",
    timezone: "Africa/Casablanca",
  });
  return buildTaskCalendarProjection({
    range,
    view: "week",
    dateField: "due",
    todayDate: "2026-05-06",
    tasks: [
      task({ id: "task-1", title: "First task" }),
      task({ id: "task-2", title: "Second task" }),
      task({ id: "task-3", title: "Third task" }),
      task({ id: "task-4", title: "Fourth task" }),
    ],
    scheduledTasks: [
      task({
        id: "task-scheduled",
        title: "Scheduled focus",
        due_date: null,
        scheduled_start_at: "2026-05-06T09:00:00.000Z",
        scheduled_end_at: "2026-05-06T10:00:00.000Z",
      }),
    ],
    sessions: [
      {
        id: "session-1",
        taskId: "task-1",
        title: "First task",
        startIso: "2026-05-06T12:00:00.000Z",
        endIso: "2026-05-06T12:30:00.000Z",
      },
    ],
  });
}

function buildMonthProjection() {
  const range = buildCalendarRange({
    view: "month",
    anchorDate: "2026-05-06",
    timezone: "Africa/Casablanca",
  });
  return buildTaskCalendarProjection({
    range,
    view: "month",
    dateField: "due",
    todayDate: "2026-05-06",
    tasks: [
      task({ id: "task-1", title: "First task" }),
      task({ id: "task-2", title: "Second task" }),
      task({ id: "task-3", title: "Third task" }),
      task({ id: "task-4", title: "Fourth task" }),
    ],
    scheduledTasks: [],
    sessions: [],
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("task calendar surfaces", () => {
  it("renders one month grid cell per visible day and caps a day at three chips", async () => {
    const data = buildMonthProjection();
    await act(async () => {
      root.render(
        <TaskCalendarMonth
          data={data}
          navigation={NAVIGATION}
          returnTo="/tasks?layout=calendar"
          rescheduleAction={vi.fn()}
        />,
      );
    });

    expect(container.querySelectorAll('[role="gridcell"]').length).toBe(data.days.length);
    expect(container.querySelectorAll('[role="columnheader"]').length).toBe(7);
    expect(container.querySelector(".calendar-more")?.textContent).toContain("+1 more");
    // The day with four tasks shows three chips plus the more control.
    expect(container.textContent).toContain("First task");
    expect(container.textContent).not.toContain("Fourth task");
  });

  it("marks today and exposes a keyboard reachable move button per task", async () => {
    const data = buildMonthProjection();
    await act(async () => {
      root.render(
        <TaskCalendarMonth
          data={data}
          navigation={NAVIGATION}
          returnTo="/tasks?layout=calendar"
          rescheduleAction={vi.fn()}
        />,
      );
    });

    expect(container.querySelectorAll(".calendar-today-label").length).toBeGreaterThan(0);
    const chip = container.querySelector<HTMLButtonElement>(".calendar-chip");
    expect(chip?.tagName).toBe("BUTTON");
    expect(chip?.getAttribute("aria-label")).toContain("Open move menu");
    expect(chip?.getAttribute("draggable")).toBe("true");
  });

  it("renders timer sessions read-only and scheduled blocks as movable", async () => {
    const data = buildWeekProjection();
    await act(async () => {
      root.render(
        <TaskCalendarWeek
          data={data}
          navigation={NAVIGATION}
          returnTo="/tasks?layout=calendar"
          rescheduleAction={vi.fn()}
        />,
      );
    });

    const session = container.querySelector(".calendar-timed-session");
    expect(session).not.toBeNull();
    expect(session?.getAttribute("aria-label")).toContain("Read-only");
    expect(session?.getAttribute("draggable")).toBeNull();
    expect(session?.querySelector("button")).toBeNull();
    expect(session?.textContent).toContain("Timer");

    const scheduled = container.querySelector<HTMLButtonElement>(".calendar-timed-scheduled");
    expect(scheduled).not.toBeNull();
    expect(scheduled?.getAttribute("draggable")).toBe("true");
    expect(scheduled?.getAttribute("aria-label")).toContain("scheduled");
  });

  it("shows an honest empty state when the range has nothing", async () => {
    const range = buildCalendarRange({
      view: "week",
      anchorDate: "2026-05-06",
      timezone: "Africa/Casablanca",
    });
    const data = buildTaskCalendarProjection({
      range,
      view: "week",
      dateField: "planned",
      todayDate: "2026-05-06",
      tasks: [],
      scheduledTasks: [],
      sessions: [],
    });

    await act(async () => {
      root.render(
        <TaskCalendarWeek
          data={data}
          navigation={NAVIGATION}
          returnTo="/tasks?layout=calendar"
          rescheduleAction={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Nothing scheduled in this range");
  });
});
