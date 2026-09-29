import { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("../_lib/home-activity-pulse", () => ({
  getHomeActivityPulseData: vi.fn(),
}));

import { getHomeActivityPulseData } from "../_lib/home-activity-pulse";
import type { HomeActivityPulse, HomeActivityPulseDay } from "../_lib/home-activity-pulse";

import { ActivityPulseSection } from "./activity-pulse-section";

const mockGetHomeActivityPulseData = vi.mocked(getHomeActivityPulseData);

function dateRange(startInclusive: string, endInclusive: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${startInclusive}T00:00:00.000Z`);
  const end = new Date(`${endInclusive}T00:00:00.000Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function buildPulse(overrides: Partial<HomeActivityPulse> & { days: HomeActivityPulseDay[] }): HomeActivityPulse {
  return {
    startDate: overrides.days[0]?.date ?? "2026-08-01",
    endDate: overrides.days[overrides.days.length - 1]?.date ?? "2026-09-05",
    currentStreak: 4,
    activeDays: overrides.days.filter((day) => day.intensity > 0).length,
    trackedSeconds: 20 * 3600,
    completedTasks: 6,
    sessionCount: 12,
    ...overrides,
  };
}

function daysWithIntensity(dates: string[], intensity: 0 | 1 | 2 | 3 | 4): HomeActivityPulseDay[] {
  return dates.map((date) => ({ date, intensity }));
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
  vi.clearAllMocks();
});

function ActivityPulseSectionHarness() {
  return (
    <Suspense fallback={null}>
      <ActivityPulseSection />
    </Suspense>
  );
}

async function renderSection(pulse: HomeActivityPulse) {
  mockGetHomeActivityPulseData.mockResolvedValue({ data: pulse, errorMessage: null });
  await act(async () => {
    root.render(<ActivityPulseSectionHarness />);
  });
  return container;
}

it("renders the pulse summary and links to full analytics", async () => {
  const pulse = buildPulse({
    days: daysWithIntensity(dateRange("2026-08-01", "2026-09-05"), 1),
  });
  const rendered = await renderSection(pulse);

  const card = rendered.querySelector('[data-testid="home-activity-pulse"]');
  expect(card).not.toBeNull();
  expect(card?.textContent).toContain("Activity pulse");
  expect(card?.textContent).toContain("4-day streak");
  expect(card?.querySelector('a[href="/work-analytics"]')).not.toBeNull();
  expect(card?.querySelector('[role="img"][aria-label*="Activity pulse"]')).not.toBeNull();
});

it("compares the current month against the same day-of-month range of the previous month (steady)", async () => {
  // Sep 1-5: 3 active; Aug 1-5: 3 active; Aug 6-31: 10 more active.
  // Old behavior compared 3 against 13 and said "Lighter than last month".
  const active = new Set([
    ...dateRange("2026-08-01", "2026-08-03"),
    ...dateRange("2026-08-06", "2026-08-15"),
    ...dateRange("2026-09-01", "2026-09-03"),
  ]);
  const days = dateRange("2026-08-01", "2026-09-05").map((date) => ({
    date,
    intensity: (active.has(date) ? 2 : 0) as 0 | 2,
  }));
  const rendered = await renderSection(buildPulse({ days }));

  expect(rendered.textContent).toContain("Steady — you're even with last month.");
  expect(rendered.textContent).not.toContain("Lighter than last month");
});

it("reads as more active when the elapsed range beats the previous month's same range", async () => {
  // Sep 1-5: 3 active; Aug 1-5: 0 active; Aug 6-31: 10 more active.
  // Old behavior compared 3 against 10 and said "Lighter than last month".
  const active = new Set([...dateRange("2026-08-06", "2026-08-15"), ...dateRange("2026-09-01", "2026-09-03")]);
  const days = dateRange("2026-08-01", "2026-09-05").map((date) => ({
    date,
    intensity: (active.has(date) ? 2 : 0) as 0 | 2,
  }));
  const rendered = await renderSection(buildPulse({ days }));

  expect(rendered.textContent).toContain("Keep it up! You're more active than last month.");
});

it("still reads as lighter when the elapsed range trails the previous month's same range", async () => {
  const active = new Set([...dateRange("2026-08-01", "2026-08-05"), ...dateRange("2026-09-01", "2026-09-02")]);
  const days = dateRange("2026-08-01", "2026-09-05").map((date) => ({
    date,
    intensity: (active.has(date) ? 2 : 0) as 0 | 2,
  }));
  const rendered = await renderSection(buildPulse({ days }));

  expect(rendered.textContent).toContain("Lighter than last month — every day counts.");
});

it("shows the no-activity note when there is no activity at all", async () => {
  const days = daysWithIntensity(dateRange("2026-08-01", "2026-09-05"), 0);
  const rendered = await renderSection(buildPulse({ days, currentStreak: 0 }));

  expect(rendered.textContent).toContain("No activity yet this year");
});
