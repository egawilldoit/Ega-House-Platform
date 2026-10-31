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

vi.mock("@/components/timer/live-duration", () => ({
  LiveDuration: ({ startedAt }: { startedAt: string }) => (
    <span data-testid="mock-live-duration" data-started-at={startedAt} />
  ),
}));

// Keep stat values at their final value in jsdom; the count-up itself is a
// client-only progressive enhancement and is covered by its reduced-motion path.
vi.mock("motion/react", () => ({
  useReducedMotion: () => true,
}));

vi.mock("../_lib/home-activity-pulse", () => ({
  getHomeActivityPulseData: vi.fn(),
}));

import type { OperatorTask } from "@ega/application";

import { QUICK_TASK_EVENT } from "@/lib/workspace-events";
import { getHomeActivityPulseData } from "../_lib/home-activity-pulse";
import type { HomeActivityPulse } from "../_lib/home-activity-pulse";

import { AuthenticatedHomePage } from "./authenticated-home-page";

const mockGetHomeActivityPulseData = vi.mocked(getHomeActivityPulseData);

function task(overrides: Partial<OperatorTask> & { id: string }): OperatorTask {
  const { id, ...rest } = overrides;
  return {
    id,
    title: `Task ${id}`,
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
    updatedAt: "2026-09-13T10:00:00.000Z",
    completedAt: null,
    focusRank: null,
    plannedForDate: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    projectName: "EGA House",
    projectSlug: "ega-house",
    goalTitle: null,
    hasActiveTimer: false,
    isDueToday: false,
    isPlannedForToday: false,
    dueBucket: "none",
    ...rest,
  };
}

const ACTIVITY_PULSE: HomeActivityPulse = {
  startDate: "2026-09-01",
  endDate: "2026-09-27",
  currentStreak: 6,
  activeDays: 18,
  trackedSeconds: 42 * 3600,
  completedTasks: 23,
  sessionCount: 31,
  days: Array.from({ length: 84 }, (_, index) => ({
    date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
    intensity: (index % 5) as 0 | 1 | 2 | 3 | 4,
  })),
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mockGetHomeActivityPulseData.mockResolvedValue({ data: ACTIVITY_PULSE, errorMessage: null });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function render(
  model: Parameters<typeof AuthenticatedHomePage>[0]["model"],
  options: { greeting?: Parameters<typeof AuthenticatedHomePage>[0]["greeting"] } = {},
) {
  await act(async () => {
    root.render(
      <AuthenticatedHomePage model={model} greeting={options.greeting ?? null} name="ab.mortaki" />,
    );
  });
}

type HomeModel = Parameters<typeof AuthenticatedHomePage>[0]["model"];

function previewTask(id: string, overrides: Partial<HomeModel["myTasks"]["tabs"][number]["tasks"][number]> = {}) {
  return {
    id,
    title: `Task ${id}`,
    status: "todo",
    priority: "medium",
    dueDate: "2026-09-27",
    projectName: "EGA House",
    projectSlug: "ega-house",
    href: `/tasks/projects/ega-house#task-${id}`,
    ...overrides,
  };
}

function defaultStats(): HomeModel["stats"] {
  return {
    activeProjects: { count: 2, atRiskCount: 1, href: "/tasks/projects?view=active" },
    openTasks: { count: 5, href: "/tasks?tasks=active" },
    completedThisWeek: { count: 3, href: "/work-analytics?range=this-week" },
    overdue: { count: 1, href: "/tasks?due=overdue&sort=due" },
    trackedThisWeek: { minutes: 120, href: "/work-analytics?range=this-week" },
  };
}

function emptyModel(overrides: Partial<HomeModel> = {}): HomeModel {
  return {
    date: "2026-09-27",
    timezone: "Africa/Casablanca",
    activeTimer: null,
    startHere: null,
    nextUp: null,
    todayProgress: null,
    attention: { overdue: 0, dueToday: 0, reviewMissing: false },
    availability: { operator: "available", attention: "available" },
    stats: defaultStats(),
    deadlines: [
      {
        key: "today",
        label: "Today",
        href: "/tasks?due=today&sort=due&tasks=active",
        count: 1,
        tasks: [previewTask("today-1")],
      },
      {
        key: "tomorrow",
        label: "Tomorrow",
        href: "/tasks?dueWithin=1&filter=due_bucket%3Ais_not%3Atoday&sort=due&tasks=active",
        count: 0,
        tasks: [],
      },
      {
        key: "thisWeek",
        label: "This week",
        href: "/tasks?due=next_7_days&sort=due&tasks=active",
        count: 0,
        tasks: [],
      },
    ],
    myTasks: {
      activeTab: "upcoming",
      tabs: [
        {
          key: "upcoming",
          label: "Upcoming",
          href: "/home?myTasks=upcoming",
          viewAllHref: "/tasks?filter=due_bucket%3Ais_not%3Aoverdue&sort=due&tasks=active",
          count: 1,
          tasks: [previewTask("up-1")],
        },
        {
          key: "overdue",
          label: "Overdue",
          href: "/home?myTasks=overdue",
          viewAllHref: "/tasks?due=overdue&sort=due",
          count: 0,
          tasks: [],
        },
        {
          key: "completed",
          label: "Completed",
          href: "/home?myTasks=completed",
          viewAllHref: "/tasks?status=done&archive=all",
          count: 0,
          tasks: [],
        },
      ],
    },
    ...overrides,
  };
}

const Greeting = {
  greeting: "Good morning, ab.mortaki",
  dateLine: "FRI, SEP 27, 2026",
  fullDateLine: "Friday, September 27",
  subtitle: "Let's make progress today.",
};

describe("AuthenticatedHomePage (EGA-663)", () => {
  it("makes the active timer the dominant state and feeds startedAt to the live duration", async () => {
    await render(
      emptyModel({
        activeTimer: {
          sessionId: "s1",
          taskId: "a",
          task: task({ id: "a", title: "Deep work" }),
          startedAt: "2026-09-14T10:00:00.000Z",
        },
        startHere: task({ id: "b", title: "Other work" }),
      }),
    );

    expect(container.querySelector('[data-testid="home-active-timer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="home-start-here"]')).toBeNull();
    expect(container.textContent).toContain("Deep work");
    expect(container.textContent).toContain("Focus running");
    expect(container.textContent).toContain("Open timer");

    const live = container.querySelector('[data-testid="mock-live-duration"]');
    expect(live).not.toBeNull();
    expect(live?.getAttribute("data-started-at")).toBe("2026-09-14T10:00:00.000Z");
  });

  it("degraded active timer shows Timer active without inventing a duration", async () => {
    await render(
      emptyModel({
        activeTimer: { sessionId: "s1", taskId: "a", task: null, startedAt: null },
      }),
    );

    expect(container.querySelector('[data-testid="home-active-timer"]')).not.toBeNull();
    expect(container.textContent).toContain("Timer active");
    expect(container.querySelector('[data-testid="mock-live-duration"]')).toBeNull();
  });

  it("renders Start Here from canonical focus when no timer is active", async () => {
    await render(
      emptyModel({
        startHere: task({ id: "a", title: "Write the plan", priority: "high", goalTitle: "Launch" }),
      }),
    );

    expect(container.querySelector('[data-testid="home-start-here"]')).not.toBeNull();
    expect(container.textContent).toContain("Write the plan");
    // The CTA must not claim the task was started; it only opens the timer flow.
    expect(container.textContent).toContain("Open timer");
    expect(container.textContent).not.toContain("Start task");
  });

  it("View Task links to the exact task/project context", async () => {
    await render(
      emptyModel({
        startHere: task({ id: "a", title: "Write the plan" }),
      }),
    );

    const viewTask = [...container.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("View task"),
    );
    expect(viewTask?.getAttribute("href")).toBe("/tasks/projects/ega-house#task-a");
  });

  it("shows a calm empty Start Here state with no fabricated work", async () => {
    await render(emptyModel());
    const empty = container.querySelector('[data-testid="home-start-here-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("Nothing queued");
  });

  it("renders each task id in exactly one Home surface and drops the multi-item queue", async () => {
    await render(
      emptyModel({
        startHere: task({ id: "a", title: "Start task" }),
        nextUp: task({ id: "b", title: "Follow-up" }),
      }),
    );

    const renderedIds = [...container.querySelectorAll("[data-task-id]")].map((element) =>
      element.getAttribute("data-task-id"),
    );
    expect(renderedIds.length).toBeGreaterThan(0);
    expect(new Set(renderedIds).size).toBe(renderedIds.length);

    const next = container.querySelector('[data-testid="home-next"]');
    expect(next?.textContent).toContain("Follow-up");
    // The full focus queue is gone from Home.
    expect(container.querySelector('[data-testid="home-focus-queue"]')).toBeNull();
    expect(container.textContent).not.toContain("Up next");
  });

  it("renders compact Today progress scoped to the Today projection", async () => {
    await render(
      emptyModel({
        todayProgress: {
          completedCount: 3,
          totalCount: 6,
          plannedCount: 3,
          inProgressCount: 1,
          totalEstimateMinutes: 90,
          ratio: 50,
        },
      }),
    );

    const today = container.querySelector('[data-testid="home-today"]');
    expect(today?.textContent).toContain("3 of 6 complete");
    expect(today?.textContent).toContain("1h 30m planned");
    expect(today?.textContent).toContain("Planned today");
    expect(today?.textContent).toContain("In progress today");
    expect(today?.textContent).toContain("50%");
    expect(today?.querySelector('a[href="/today"]')).not.toBeNull();
  });

  it("keeps the Today empty state compact with a link to Today", async () => {
    await render(
      emptyModel({
        todayProgress: {
          completedCount: 0,
          totalCount: 0,
          plannedCount: 0,
          inProgressCount: 0,
          totalEstimateMinutes: 0,
          ratio: null,
        },
      }),
    );

    const today = container.querySelector('[data-testid="home-today"]');
    expect(today?.textContent).toContain("Nothing is planned for today yet.");
    expect(today?.querySelector('a[href="/today"]')).not.toBeNull();
  });

  it("reuses canonical attention counts and their canonical destinations", async () => {
    await render(emptyModel({ attention: { overdue: 3, dueToday: 2, reviewMissing: true } }));

    const attention = container.querySelector('[data-testid="home-attention"]');
    expect(attention).not.toBeNull();
    expect(attention?.textContent).toContain("Overdue");
    expect(attention?.textContent).toContain("3");
    expect(attention?.textContent).toContain("Due today");
    expect(attention?.textContent).toContain("2");
    expect(attention?.textContent).toContain("Weekly review due");

    expect(attention?.querySelector('a[href="/tasks?due=overdue"]')).not.toBeNull();
    expect(attention?.querySelector('a[href="/tasks?due=due_today"]')).not.toBeNull();
    expect(attention?.querySelector('a[href="/review"]')).not.toBeNull();
  });

  it("shows a verified clear state only when attention data is available", async () => {
    await render(
      emptyModel({
        attention: { overdue: 0, dueToday: 0, reviewMissing: false },
        availability: { operator: "available", attention: "available" },
      }),
    );

    expect(container.textContent).toContain("You’re clear right now.");
  });

  it("never claims a clear state when attention metrics are unavailable", async () => {
    await render(
      emptyModel({
        attention: null,
        availability: { operator: "available", attention: "unavailable" },
      }),
    );

    const attention = container.querySelector('[data-testid="home-attention"]');
    expect(attention?.textContent).toContain("Attention status unavailable.");
    expect(attention?.textContent).not.toContain("clear right now");
  });

  it("renders the degraded operator notice instead of fabricated focus work", async () => {
    await render(emptyModel({ availability: { operator: "unavailable", attention: "unavailable" } }));

    expect(container.querySelector('[data-testid="home-degraded"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="home-start-here"]')).toBeNull();
  });

  it("shows the greeting block with canonical date lines when the snapshot is available", async () => {
    await render(emptyModel(), { greeting: Greeting });

    expect(container.textContent).toContain("Good morning, ab.mortaki");
    expect(container.textContent).toContain("FRI, SEP 27, 2026");
    expect(container.textContent).toContain("Let's make progress today.");
  });

  it("falls back to a time-neutral welcome without date claims when the snapshot is unavailable", async () => {
    await render(emptyModel({ date: "", timezone: "" }));

    expect(container.textContent).toContain("Welcome back, ab.mortaki");
    expect(container.textContent).not.toContain("Let's make progress today.");
  });

  it("quick actions dispatch the canonical existing events with the simplified controls", async () => {
    const quickTask = vi.fn();
    window.addEventListener(QUICK_TASK_EVENT, quickTask);

    await render(emptyModel());

    await act(async () => {
      container
        .querySelector('[data-testid="home-create-task"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(quickTask).toHaveBeenCalledTimes(1);

    expect(container.textContent).toContain("Create");
    expect(container.textContent).not.toContain("Add to Backlog");
    expect(container.textContent).toContain("Timer");
    expect(container.querySelector('[data-testid="home-start-timer"]')?.getAttribute("href")).toBe(
      "/timer",
    );

    // Shortcut hints must match the canonical bindings (Ctrl/Cmd+Shift+N/T),
    // never misleading bindings that the shell does not handle.
    const hints = Array.from(container.querySelectorAll("kbd")).map((node) => node.textContent?.trim());
    expect(hints).toEqual(["⌘⇧N", "⌘⇧T"]);

    window.removeEventListener(QUICK_TASK_EVENT, quickTask);
  });

  it("removes the four-card Daily execution overview KPI grid", async () => {
    await render(emptyModel());

    expect(container.textContent).not.toContain("Daily execution overview");
    expect(container.textContent).not.toContain("Focus time");
  });

  it("renders the canonical activity pulse and links to full analytics", async () => {
    await render(emptyModel());

    const pulse = container.querySelector('[data-testid="home-activity-pulse"]');
    expect(pulse).not.toBeNull();
    expect(pulse?.textContent).toContain("Activity pulse");
    expect(pulse?.textContent).toContain("54 contributions in the last year");
    expect(pulse?.textContent).toContain("6-day streak");
    expect(pulse?.querySelector('a[href="/work-analytics"]')).not.toBeNull();
  });

  it("degrades the activity section without blanking the primary Now experience", async () => {
    mockGetHomeActivityPulseData.mockResolvedValue({
      data: null,
      errorMessage: "Activity pulse unavailable right now.",
    });

    await render(emptyModel());

    expect(container.querySelector('[data-testid="home-activity-pulse-unavailable"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="home-activity-pulse"]')).toBeNull();
    // The primary surfaces remain intact.
    expect(container.querySelector('[data-testid="home-workspace"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="home-today"]')).not.toBeNull();
  });

  it("renders clickable stat cards with canonical destinations and exact values", async () => {
    await render(emptyModel());

    const stats = container.querySelector('[data-testid="home-stats"]');
    expect(stats).not.toBeNull();
    expect(stats?.textContent).toContain("Active projects");
    expect(stats?.textContent).toContain("2");
    expect(stats?.textContent).toContain("1 at risk");
    expect(stats?.textContent).toContain("2h");

    const linkFor = (testId: string) =>
      container.querySelector(`[data-testid="${testId}"]`);
    expect(linkFor("home-stat-projects")?.getAttribute("href")).toBe(
      "/tasks/projects?view=active",
    );
    expect(linkFor("home-stat-open-tasks")?.getAttribute("href")).toBe("/tasks?tasks=active");
    expect(linkFor("home-stat-completed")?.getAttribute("href")).toBe(
      "/work-analytics?range=this-week",
    );
    expect(linkFor("home-stat-overdue")?.getAttribute("href")).toBe(
      "/tasks?due=overdue&sort=due",
    );
    expect(linkFor("home-stat-tracked")?.getAttribute("href")).toBe(
      "/work-analytics?range=this-week",
    );
    // Whole cards are links with an explicit accessible name.
    expect(linkFor("home-stat-open-tasks")?.tagName).toBe("A");
    expect(linkFor("home-stat-open-tasks")?.getAttribute("aria-label")).toContain("Open tasks: 5");
  });

  it("renders unavailable stat panels without inventing a zero", async () => {
    const stats = defaultStats();
    await render(
      emptyModel({
        stats: {
          ...stats,
          openTasks: { ...stats.openTasks, count: null },
          trackedThisWeek: { ...stats.trackedThisWeek, minutes: null },
        },
      }),
    );

    const open = container.querySelector('[data-testid="home-stat-open-tasks"]');
    const tracked = container.querySelector('[data-testid="home-stat-tracked"]');
    expect(open?.textContent).toContain("Unavailable right now");
    expect(open?.textContent).not.toContain("0");
    expect(tracked?.textContent).toContain("Unavailable right now");
    expect(tracked?.textContent).not.toContain("0m");
  });

  it("keeps deadline totals beyond the preview and links the full canonical scope", async () => {
    const base = emptyModel();
    await render(
      emptyModel({
        deadlines: [
          {
            key: "today",
            label: "Today",
            href: "/tasks?due=today&sort=due&tasks=active",
            count: 12,
            tasks: [previewTask("today-1"), previewTask("today-2")],
          },
          base.deadlines[1]!,
          base.deadlines[2]!,
        ],
      }),
    );

    const today = container.querySelector('[data-testid="home-deadline-today"]');
    expect(today?.textContent).toContain("12");
    expect(today?.textContent).toContain("View all 12");
    expect(today?.querySelector('a[href="/tasks?due=today&sort=due&tasks=active"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="home-deadline-tomorrow"]')?.textContent).toContain(
      "Nothing due",
    );
  });

  it("shows unavailable deadline buckets instead of a false empty state", async () => {
    const base = emptyModel();
    await render(
      emptyModel({
        deadlines: [
          { ...base.deadlines[0]!, count: null, tasks: [] },
          base.deadlines[1]!,
          base.deadlines[2]!,
        ],
      }),
    );

    const today = container.querySelector('[data-testid="home-deadline-today"]');
    expect(today?.textContent).toContain("Unavailable right now");
    expect(today?.textContent).not.toContain("Nothing due");
  });

  it("renders URL-backed My tasks tabs with the active tab and its exact destination", async () => {
    const base = emptyModel();
    await render(
      emptyModel({
        myTasks: {
          activeTab: "overdue",
          tabs: base.myTasks.tabs.map((tab) =>
            tab.key === "overdue"
              ? {
                  ...tab,
                  count: 9,
                  tasks: [previewTask("over-1"), previewTask("over-2")],
                }
              : tab,
          ),
        },
      }),
    );

    const panel = container.querySelector('[data-testid="home-my-tasks"]');
    expect(panel?.textContent).toContain("Overdue 9");
    expect(panel?.textContent).toContain("View all 9 tasks");
    const activeTab = panel?.querySelector('a[aria-current="page"]');
    expect(activeTab?.getAttribute("href")).toBe("/home?myTasks=overdue");
    expect(panel?.querySelector('a[href="/home?myTasks=completed"]')).not.toBeNull();
    expect(panel?.querySelector('a[href="/tasks?due=overdue&sort=due"]')).not.toBeNull();
  });

  it("distinguishes an unavailable My tasks read from an empty tab", async () => {
    const base = emptyModel();
    await render(
      emptyModel({
        myTasks: {
          activeTab: "completed",
          tabs: base.myTasks.tabs.map((tab) =>
            tab.key === "completed" ? { ...tab, count: null, tasks: [] } : tab,
          ),
        },
      }),
    );

    const panel = container.querySelector('[data-testid="home-my-tasks"]');
    expect(panel?.textContent).toContain("Tasks are unavailable right now");
    expect(panel?.textContent).not.toContain("No completed tasks yet");
  });

  it("renders Now/start without waiting for independent analytics", async () => {
    await render(
      emptyModel({
        startHere: task({ id: "s1", title: "Ship the fix", priority: "high" }),
        stats: {
          activeProjects: { count: null, atRiskCount: null, href: "/tasks/projects?view=active" },
          openTasks: { count: null, href: "/tasks?tasks=active" },
          completedThisWeek: { count: null, href: "/work-analytics?range=this-week" },
          overdue: { count: null, href: "/tasks?due=overdue&sort=due" },
          trackedThisWeek: { minutes: null, href: "/work-analytics?range=this-week" },
        },
      }),
    );

    expect(container.querySelector('[data-testid="home-start-here"]')).not.toBeNull();
    expect(container.textContent).toContain("Ship the fix");
    expect(container.textContent).toContain("Open timer");
  });
});
