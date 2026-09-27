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
    const fetchMock = vi.fn(async () => ({
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

    expect(fetchMock).toHaveBeenCalledWith("/work-activity/day-details?date=2026-09-23");
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
});
