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

import type { OperatorTask } from "@ega/application";

import { INBOX_CAPTURE_EVENT, QUICK_TASK_EVENT } from "@/lib/workspace-events";

import { AuthenticatedHomePage } from "./authenticated-home-page";

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

async function render(model: Parameters<typeof AuthenticatedHomePage>[0]["model"]) {
  await act(async () => {
    root.render(<AuthenticatedHomePage model={model} />);
  });
}

type HomeSummary = NonNullable<Parameters<typeof AuthenticatedHomePage>[0]["model"]["summary"]>;

function summary(overrides: Partial<HomeSummary> = {}): HomeSummary {
  return {
    plannedCount: 0,
    inProgressCount: 0,
    blockedCount: 0,
    completedCount: 0,
    selectedCount: 0,
    clearableCompletedCount: 0,
    overdueCount: 0,
    dueTodayCount: 0,
    totalEstimateMinutes: 0,
    trackedTodaySeconds: 0,
    trackedTodayLabel: "0m",
    ...overrides,
  };
}

function emptyModel(overrides: Partial<Parameters<typeof AuthenticatedHomePage>[0]["model"]> = {}) {
  return {
    activeTimer: null,
    startHere: null,
    nextUp: null,
    attention: { overdue: 0, dueToday: 0, reviewMissing: false },
    snapshotUnavailable: false,
    summary: null,
    sections: null,
    focusQueue: [],
    ...overrides,
  };
}

describe("AuthenticatedHomePage (EGA-653)", () => {
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

  it("shows a calm empty Start Here state with no fabricated work", async () => {
    await render(emptyModel());
    const empty = container.querySelector('[data-testid="home-start-here-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("Nothing queued");
  });

  it("renders each task id in exactly one Home surface and drops the next-up strip", async () => {
    await render(
      emptyModel({
        startHere: task({ id: "a", title: "Start task" }),
        nextUp: task({ id: "b", title: "Follow-up" }),
        focusQueue: [
          task({ id: "a", title: "Start task" }),
          task({ id: "b", title: "Follow-up" }),
          task({ id: "c", title: "Third task" }),
        ],
      }),
    );

    const renderedIds = [...container.querySelectorAll("[data-task-id]")].map((element) =>
      element.getAttribute("data-task-id"),
    );
    expect(renderedIds.length).toBeGreaterThan(0);
    expect(new Set(renderedIds).size).toBe(renderedIds.length);
    expect(container.querySelector('[data-testid="home-next-up"]')).toBeNull();
    expect(container.textContent).toContain("Follow-up");
  });

  it("formats the Focus time KPI at minute precision, never seconds", async () => {
    await render(emptyModel({ summary: summary({ trackedTodaySeconds: 59 * 60 + 23 }) }));

    const text = container.querySelector('[data-testid="home-workspace"]')?.textContent ?? "";
    expect(text).toContain("Focus time");
    expect(text).toContain("59m");
    expect(text).not.toContain("23s");
  });

  it("renders positive sub-minute focus time as <1m, never 0m", async () => {
    await render(emptyModel({ summary: summary({ trackedTodaySeconds: 30 }) }));

    expect(container.querySelector('[data-testid="home-workspace"]')?.textContent).toContain(
      "<1m",
    );
  });

  it("scopes the Progress counts to today and formats the planned load centrally", async () => {
    await render(
      emptyModel({
        summary: summary({
          plannedCount: 2,
          inProgressCount: 1,
          completedCount: 3,
          totalEstimateMinutes: 90,
        }),
      }),
    );

    const progress = container.querySelector('[data-testid="home-progress"]');
    expect(progress?.textContent).toContain("Planned today");
    expect(progress?.textContent).toContain("In progress today");
    expect(progress?.textContent).toContain("2");
    expect(progress?.textContent).toContain("1");
    expect(progress?.textContent).toContain("1h 30m");
    expect(progress?.textContent).toContain("50%");
  });

  it("keeps the Progress empty state compact with a link to Today", async () => {
    await render(emptyModel({ summary: summary() }));

    const progress = container.querySelector('[data-testid="home-progress"]');
    expect(progress?.textContent).toContain("Nothing is planned for today yet.");
    expect(progress?.querySelector('a[href="/today"]')).not.toBeNull();
    expect(progress?.querySelector("dl")).toBeNull();
  });

  it("hides Start Here from Up next while preserving canonical queue order", async () => {
    await render(
      emptyModel({
        startHere: task({ id: "a", title: "Start task" }),
        focusQueue: [
          task({ id: "a", title: "Start task" }),
          task({ id: "b", title: "Second task" }),
          task({ id: "c", title: "Third task" }),
        ],
      }),
    );

    const panel = container.querySelector('[data-testid="home-focus-queue"]');
    const text = panel?.textContent ?? "";
    expect(text).toContain("Up next");
    expect(text).not.toContain("Start task");
    expect(text.indexOf("Second task")).toBeGreaterThan(-1);
    expect(text.indexOf("Second task")).toBeLessThan(text.indexOf("Third task"));
  });

  it("shows a compact Up next line when Start Here is the only queued task", async () => {
    await render(
      emptyModel({
        startHere: task({ id: "a", title: "Start task" }),
        focusQueue: [task({ id: "a", title: "Start task" })],
      }),
    );

    const panel = container.querySelector('[data-testid="home-focus-queue"]');
    expect(panel?.textContent).toContain("Nothing else queued right now.");
    expect(panel?.textContent).not.toContain("Start task");
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

  it("quick actions dispatch the canonical existing events", async () => {
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
    expect(container.querySelector('[data-testid="home-start-timer"]')?.getAttribute("href")).toBe("/timer");

    window.removeEventListener(QUICK_TASK_EVENT, quickTask);
    window.removeEventListener(INBOX_CAPTURE_EVENT, capture);
  });
});
