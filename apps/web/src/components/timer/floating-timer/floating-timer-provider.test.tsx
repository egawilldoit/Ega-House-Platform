// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readActiveTimerSnapshotAction: vi.fn(),
  stopActiveTimerSessionAction: vi.fn(),
  routerRefresh: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      href,
      children,
      ...props
    }: {
      href: string;
      children: React.ReactNode;
    }) => React.createElement("a", { href, ...props }, children),
  };
});

vi.mock("@/app/(workspace)/active-timer-actions", () => ({
  readActiveTimerSnapshotAction: mocks.readActiveTimerSnapshotAction,
  stopActiveTimerSessionAction: mocks.stopActiveTimerSessionAction,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ channel: () => {} }),
}));

vi.mock("@/lib/supabase/realtime", () => ({
  subscribeToOwnerScopedRealtimeChanges: (
    _client: unknown,
    config: { onPayload: () => void },
  ) => {
    mocks.subscribe(config.onPayload);
    return () => {};
  },
}));

import { ActiveTimerProvider } from "./active-timer-provider";
import { FloatingTimerChip } from "./floating-timer-chip";
import type { ActiveTimerSessionSnapshot } from "@/lib/timer/active-timer-contract";

const session: ActiveTimerSessionSnapshot = {
  sessionId: "session-1",
  taskId: "task-1",
  taskTitle: "Ship the floating timer",
  projectName: "EGA House",
  projectSlug: "ega-house",
  startedAt: "2026-11-14T10:00:00.000Z",
  taskHref: "/tasks/projects/ega-house#task-task-1",
};

let container: HTMLDivElement;
let root: Root;

function activeResult(active: ActiveTimerSessionSnapshot | null = session) {
  return {
    ok: true as const,
    syncedAt: "2026-11-14T10:05:00.000Z",
    session: active,
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount() {
  act(() => {
    root.render(
      <ActiveTimerProvider
        ownerUserId="owner-a"
        initialResult={activeResult()}
      >
        <FloatingTimerChip />
      </ActiveTimerProvider>,
    );
  });
}

function buttonByLabel(label: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.getAttribute("aria-label") === label,
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.readActiveTimerSnapshotAction.mockReset();
  mocks.stopActiveTimerSessionAction.mockReset();
  mocks.routerRefresh.mockReset();
  mocks.subscribe.mockReset();
  mocks.readActiveTimerSnapshotAction.mockResolvedValue(activeResult(null));
  mocks.stopActiveTimerSessionAction.mockResolvedValue({
    ok: true,
    outcome: "stopped",
    stoppedTaskId: "task-1",
    syncedAt: "2026-11-14T10:06:00.000Z",
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("floating timer provider and chip", () => {
  it("renders the persisted active session without polling", async () => {
    mount();
    await settle();

    expect(document.body.textContent).toContain("Ship the floating timer");
    expect(document.body.textContent).toContain("EGA House");
    expect(document.body.textContent).toContain("Focus timer running");
    expect(document.querySelector('[data-testid="floating-timer-chip"]')).not.toBeNull();
    expect(mocks.readActiveTimerSnapshotAction).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Pop out");
  });

  it("stops the exact session without a redirect and clears after success", async () => {
    mount();
    await settle();

    await act(async () => {
      buttonByLabel("Stop timer for Ship the floating timer")?.click();
    });
    await settle();

    expect(mocks.stopActiveTimerSessionAction).toHaveBeenCalledWith("session-1");
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="floating-timer-chip"]')).toBeNull();
  });

  it("keeps the chip and announces an accessible error when stop fails", async () => {
    mocks.stopActiveTimerSessionAction.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "Could not stop the timer right now.",
      stoppedTaskId: null,
    });

    mount();
    await settle();

    await act(async () => {
      buttonByLabel("Stop timer for Ship the floating timer")?.click();
    });
    await settle();

    expect(document.querySelector('[data-testid="floating-timer-chip"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not stop the timer right now.",
    );
  });

  it("reconciles a stopped-elsewhere session through owner-scoped realtime", async () => {
    vi.useFakeTimers();
    mount();
    await settle();

    const onPayload = mocks.subscribe.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(onPayload).toBeTypeOf("function");

    await act(async () => {
      onPayload?.();
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.readActiveTimerSnapshotAction).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="floating-timer-chip"]')).toBeNull();
  });

  it("marks the last known state stale when a canonical read fails", async () => {
    mocks.readActiveTimerSnapshotAction.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "Timer sync unavailable.",
    });

    vi.useFakeTimers();
    mount();
    await settle();

    const onPayload = mocks.subscribe.mock.calls[0]?.[0] as (() => void) | undefined;
    await act(async () => {
      onPayload?.();
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Ship the floating timer");
    expect(document.body.textContent).toContain("Timer sync delayed");
    expect(document.body.textContent).toContain("Timer sync unavailable.");
  });
});
