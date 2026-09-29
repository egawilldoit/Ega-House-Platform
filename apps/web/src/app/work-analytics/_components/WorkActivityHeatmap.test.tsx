import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkActivityCalendar, WorkActivityDay } from "@/lib/services/work-activity-service";
import type { WorkActivityReadModel } from "@/lib/services/work-activity-read-model";
import { WorkActivityHeatmap } from "./WorkActivityHeatmap";

function makeDay(date: string, overrides: Partial<WorkActivityDay> = {}): WorkActivityDay {
  return {
    date,
    trackedSeconds: 0,
    sessionCount: 0,
    completedTaskCount: 0,
    isActive: false,
    intensityLevel: 0,
    ...overrides,
  };
}

function makeCalendar(): WorkActivityCalendar {
  // 2026-09-21 (Sat) through 2026-09-27 (Sun): 7 local days.
  const dates = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
  return {
    timezone: "UTC",
    startDate: "2026-09-21",
    endDate: "2026-09-27",
    startUtcIso: "",
    endUtcIso: "",
    days: dates.map((date, index) =>
      makeDay(date, {
        trackedSeconds: index === 2 ? 8040 : 0,
        sessionCount: index === 2 ? 3 : 0,
        completedTaskCount: index === 3 ? 2 : 0,
        isActive: index === 2 || index === 3,
        intensityLevel: index === 2 ? 2 : index === 3 ? 1 : 0,
      }),
    ),
    activeDayCount: 2,
    totalTrackedSeconds: 8040,
    totalCompletedTasks: 2,
    currentStreak: 1,
    longestStreak: 1,
    bestTrackedDay: { date: "2026-09-23", trackedSeconds: 8040 },
  };
}

function makeWorkActivity(): WorkActivityReadModel {
  return { calendar: makeCalendar(), timezone: "UTC" };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("WorkActivityHeatmap", () => {
  it("renders the summary with active days, streaks, tracked time, and completed tasks", () => {
    act(() => {
      root.render(<WorkActivityHeatmap workActivity={makeWorkActivity()} error={null} />);
    });
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("Active days");
    expect(container.textContent).toContain("Current streak");
    expect(container.textContent).toContain("Longest streak");
    expect(container.textContent).toContain("Tracked time");
    expect(container.textContent).toContain("Tasks completed");
  });

  it("renders one button per local day with a descriptive aria-label", () => {
    act(() => {
      root.render(<WorkActivityHeatmap workActivity={makeWorkActivity()} error={null} />);
    });
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(7);
    const labels = Array.from(buttons).map((b) => b.getAttribute("aria-label"));
    expect(labels[0]).toContain("Monday, September 21, 2026");
    expect(labels[0]).toContain("no activity");
    expect(labels[2]).toContain("Wednesday, September 23, 2026");
    expect(labels[2]).toContain("2h 14m tracked");
    expect(labels[2]).toContain("3 sessions");
    expect(labels[3]).toContain("2 Tasks completed");
  });

  it("renders a textual legend and an sr-only table fallback", () => {
    act(() => {
      root.render(<WorkActivityHeatmap workActivity={makeWorkActivity()} error={null} />);
    });
    expect(container.querySelector('[aria-label="Work activity legend"]')).not.toBeNull();
    const table = container.querySelector("table.sr-only");
    expect(table).not.toBeNull();
    expect(table?.querySelector("caption")?.textContent).toContain("Daily work activity");
    expect(table?.querySelectorAll("tbody tr").length).toBe(7);
  });

  it("opens the bounded day drawer when a day is clicked", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        date: "2026-09-23",
        timezone: "UTC",
        sessions: [
          {
            task_id: "t1",
            started_at: "2026-09-23T01:00:00Z",
            ended_at: "2026-09-23T03:14:00Z",
            duration_seconds: 8040,
            tasks: { id: "t1", title: "Deep work", project_id: "p1", goal_id: null, projects: { id: "p1", name: "EGA" }, goals: null },
          },
        ],
        completedTasks: [],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(<WorkActivityHeatmap workActivity={makeWorkActivity()} error={null} />);
    });

    const buttons = container.querySelectorAll("button");
    await act(async () => {
      buttons[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/work-activity/day-details?date=2026-09-23");
    // The Sheet portals to document.body, so the drawer content lives outside container.
    expect(document.body.textContent).toContain("Deep work");
    expect(document.body.textContent).toContain("Sessions");
  });

  it("shows an unavailable state when the calendar read fails", () => {
    act(() => {
      root.render(<WorkActivityHeatmap workActivity={null} error="Unable to load your timezone preference." />);
    });
    expect(container.textContent).toContain("Work activity is unavailable");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("sizes day cells via CSS variables so coarse pointers get at least 24px targets", () => {
    act(() => {
      root.render(<WorkActivityHeatmap workActivity={makeWorkActivity()} error={null} />);
    });
    const cell = container.querySelector("button");
    expect(cell, "day cells must render as buttons").not.toBeNull();
    // Rendered evidence: cell geometry is governed by the --wa-cell-size
    // variable, which only the stylesheet can resize per pointer type.
    expect(cell?.className).toContain("h-[var(--wa-cell-size)]");
    expect(cell?.className).toContain("w-[var(--wa-cell-size)]");

    // The coarse-pointer media query must raise the variable to >= 24px
    // (WCAG 2.5.8 Target Size Minimum, AA).
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const coarseBlock = css.match(/@media \(pointer: coarse\)\s*\{[^{}]*\{[\s\S]*?\}/);
    expect(coarseBlock, "globals.css must contain a @media (pointer: coarse) rule").not.toBeNull();
    const sizeMatch = coarseBlock?.[0]?.match(/--wa-cell-size:\s*(\d+)px/);
    expect(sizeMatch, "coarse-pointer rule must set --wa-cell-size").not.toBeNull();
    expect(Number(sizeMatch?.[1])).toBeGreaterThanOrEqual(24);
  });

  it("ignores a stale day-detail response when a newer day is selected", async () => {
    let resolveStale: (value: unknown) => void = () => undefined;
    const fetchMock = vi.fn((url: unknown) => {
      if (String(url).includes("date=2026-09-23")) {
        return new Promise((resolve) => {
          resolveStale = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          date: "2026-09-24",
          timezone: "UTC",
          sessions: [
            {
              task_id: "t2",
              started_at: "2026-09-24T01:00:00Z",
              ended_at: "2026-09-24T02:00:00Z",
              duration_seconds: 3600,
              tasks: { id: "t2", title: "Day B task", project_id: null, goal_id: null, projects: null, goals: null },
            },
          ],
          completedTasks: [],
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(<WorkActivityHeatmap workActivity={makeWorkActivity()} error={null} />);
    });

    const buttons = container.querySelectorAll("button");
    await act(async () => {
      buttons[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      buttons[3]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(document.body.textContent).toContain("Day B task");

    await act(async () => {
      resolveStale({
        ok: true,
        json: async () => ({
          date: "2026-09-23",
          timezone: "UTC",
          sessions: [
            {
              task_id: "t1",
              started_at: "2026-09-23T01:00:00Z",
              ended_at: "2026-09-23T02:00:00Z",
              duration_seconds: 3600,
              tasks: { id: "t1", title: "Day A task", project_id: null, goal_id: null, projects: null, goals: null },
            },
          ],
          completedTasks: [],
        }),
      });
    });
    await flush();

    expect(document.body.textContent).toContain("Day B task");
    expect(document.body.textContent).not.toContain("Day A task");
  });
});
