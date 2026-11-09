// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TodayWorkCard } from "./today-work-card";

const WORK = {
  trackedSeconds: 5400,
  workTargetMinutes: 480,
  jobSearchSeconds: 1800,
  jobSearchTargetMinutes: 90,
  jobSearchConfigured: true,
  derivedFrom: "canonical-sessions" as const,
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(props: React.ComponentProps<typeof TodayWorkCard>) {
  await act(async () => {
    root.render(<TodayWorkCard {...props} />);
  });
}

describe("TodayWorkCard", () => {
  it("shows work vs target with the job-search subset inside the total", async () => {
    await render({
      work: WORK,
      money: { available: true, totalMinor: 2250 },
      routine: { available: true, saved: true },
    });
    expect(container.textContent).toContain("1h 30m tracked / 8h target");
    expect(container.textContent).toContain("Job search inside that total: 30m / 1h 30m target.");
    expect(container.textContent).toContain("22,50");
    expect(container.textContent).toContain("Check-in saved for today.");
  });

  it("renders honest unavailable states instead of fake zeros", async () => {
    await render({
      work: null,
      money: { available: false, totalMinor: null },
      routine: { available: false, saved: false },
    });
    expect(container.textContent).toContain("Work progress unavailable right now.");
    expect(container.textContent).toContain("Money unavailable right now.");
    expect(container.textContent).toContain("Check-in status unavailable right now.");
  });

  it("distinguishes recorded-zero money and missing check-in from success", async () => {
    await render({
      work: { ...WORK, jobSearchConfigured: false, jobSearchSeconds: 0 },
      money: { available: true, totalMinor: 0 },
      routine: { available: true, saved: false },
    });
    expect(container.textContent).toContain("No spending recorded today yet.");
    expect(container.textContent).toContain("No check-in yet");
    expect(container.textContent).toContain("Job search is not configured yet");
  });
});
