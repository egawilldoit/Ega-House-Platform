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

vi.mock("../_lib/home-activity-pulse", () => ({
  getHomeActivityPulseData: vi.fn(),
}));

import type { OperatorTask } from "@ega/application";

import { INBOX_CAPTURE_EVENT, QUICK_TASK_EVENT } from "@/lib/workspace-events";
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

  it("quick actions dispatch the canonical existing events with the new labels", async () => {
    const quickTask = vi.fn();
    const capture = vi.fn();
    window.addEventListener(QUICK_TASK_EVENT, quickTask);
    window.addEventListener(INBOX_CAPTURE_EVENT, capture);

    await render(emptyModel());

    await act(async () => {
      container
        .querySelector('[data-testid="home-create-task"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('[data-testid="home-capture"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(quickTask).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);

    expect(container.textContent).toContain("Create Task");
    expect(container.textContent).toContain("Add to Backlog");
    expect(container.textContent).toContain("Timer");
    expect(container.querySelector('[data-testid="home-start-timer"]')?.getAttribute("href")).toBe(
      "/timer",
    );

    // Shortcut hints must match the canonical bindings (Ctrl/Cmd+Shift+N/I/T),
    // never the misleading plain Cmd+N/B/T that the shell does not handle.
    const hints = Array.from(container.querySelectorAll("kbd")).map((node) => node.textContent?.trim());
    expect(hints).toEqual(["⌘⇧N", "⌘⇧I", "⌘⇧T"]);

    window.removeEventListener(QUICK_TASK_EVENT, quickTask);
    window.removeEventListener(INBOX_CAPTURE_EVENT, capture);
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
});
