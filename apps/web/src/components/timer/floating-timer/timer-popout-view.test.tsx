// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimerPopoutView } from "./timer-popout-view";
import type { ActiveTimerSessionSnapshot } from "@/lib/timer/active-timer-contract";

const session: ActiveTimerSessionSnapshot = {
  sessionId: "session-1",
  taskId: "task-1",
  taskTitle: "Ship the floating timer",
  projectName: "EGA House",
  projectSlug: "ega-house",
  startedAt: new Date(Date.now() - 65_000).toISOString(),
  taskHref: "https://egawilldoit.online/tasks/projects/ega-house#task-task-1",
};

let container: HTMLDivElement;
let root: Root;

function mount(overrides: Partial<Parameters<typeof TimerPopoutView>[0]> = {}) {
  act(() => {
    root.render(
      <TimerPopoutView
        session={session}
        isCurrent
        phase="synced"
        message={null}
        stopPending={false}
        stopError={null}
        onStop={vi.fn()}
        onClose={vi.fn()}
        {...overrides}
      />,
    );
  });
}

function text() {
  return document.body.textContent ?? "";
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("TimerPopoutView", () => {
  it("shows the running task, project, clock and a working stop control", () => {
    const onStop = vi.fn();
    mount({ onStop });

    expect(text()).toContain("Running now");
    expect(text()).toContain("Ship the floating timer");
    expect(text()).toContain("EGA House");
    expect(
      document.querySelector(".ega-timer-popout__clock")?.textContent,
    ).toMatch(/^Elapsed time \d{2}:\d{2}:\d{2}$/);

    act(() => {
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Stop timer for Ship the floating timer"]',
        )
        ?.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("uses the opener-safe absolute task link and never retargets a stopped session", () => {
    mount({ isCurrent: false, phase: "synced" });

    expect(text()).toContain("Session ended");
    expect(
      document
        .querySelector<HTMLAnchorElement>('a[aria-label^="Open task"]')
        ?.getAttribute("href"),
    ).toBe("https://egawilldoit.online/tasks/projects/ega-house#task-task-1");
    expect(
      document.querySelector(
        'button[aria-label="Stop timer for Ship the floating timer"]',
      ),
    ).toBeNull();
  });

  it("marks a stale last-known state without claiming it is synced", () => {
    mount({ phase: "stale", message: "Timer sync unavailable." });

    expect(text()).toContain("Running - last known");
    expect(text()).toContain("Timer sync unavailable.");
  });

  it("announces a stop failure accessibly", () => {
    mount({
      stopError: "Could not stop the timer right now.",
      stopPending: true,
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not stop the timer right now.",
    );
    expect(text()).toContain("Stopping...");
  });
});
