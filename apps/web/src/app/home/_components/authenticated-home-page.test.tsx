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

function emptyModel(overrides: Partial<Parameters<typeof AuthenticatedHomePage>[0]["model"]> = {}) {
  return {
    activeTimer: null,
    startHere: null,
    nextUp: null,
    attention: { overdue: 0, dueToday: 0, reviewMissing: false },
    snapshotUnavailable: false,
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

  it("shows at most one Next up item", async () => {
    await render(emptyModel({ nextUp: task({ id: "n", title: "Follow-up" }) }));
    expect(container.querySelectorAll('[data-testid="home-next-up"]').length).toBe(1);
    expect(container.textContent).toContain("Follow-up");
  });

  it("reuses canonical attention counts", async () => {
    await render(emptyModel({ attention: { overdue: 3, dueToday: 2, reviewMissing: true } }));
    expect(container.textContent).toContain("3 overdue");
    expect(container.textContent).toContain("2 due today");
    expect(container.textContent).toContain("Review due");
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
