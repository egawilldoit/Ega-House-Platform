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
let hidden = false;

function setHidden(value: boolean) {
  hidden = value;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

function installPopoutApi() {
  const popoutDocument = document.implementation.createHTMLDocument("popout");
  const target = new EventTarget() as Window & {
    document: Document;
    closed: boolean;
    focus: () => void;
    close: () => void;
  };
  target.document = popoutDocument;
  target.closed = false;
  target.focus = vi.fn();
  target.close = () => {
    target.closed = true;
    target.dispatchEvent(new Event("pagehide"));
  };

  Object.defineProperty(window, "documentPictureInPicture", {
    configurable: true,
    value: { requestWindow: vi.fn(async () => target) },
  });

  return target;
}

function activeResult(
  active: ActiveTimerSessionSnapshot | null = session,
  syncedAt = "2026-11-14T10:05:00.000Z",
) {
  return {
    ok: true as const,
    syncedAt,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
  setHidden(false);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as { documentPictureInPicture?: unknown })
    .documentPictureInPicture;
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

  it("applies a newer server snapshot on the same route without remounting", async () => {
    mount();
    await settle();
    expect(document.body.textContent).toContain("Ship the floating timer");

    await act(async () => {
      root.render(
        <ActiveTimerProvider
          ownerUserId="owner-a"
          initialResult={activeResult(null)}
        >
          <FloatingTimerChip />
        </ActiveTimerProvider>,
      );
    });
    await settle();

    expect(document.querySelector('[data-testid="floating-timer-chip"]')).toBeNull();

    await act(async () => {
      root.render(
        <ActiveTimerProvider
          ownerUserId="owner-a"
          initialResult={activeResult({
            ...session,
            sessionId: "session-2",
            taskTitle: "New focus task",
          })}
        >
          <FloatingTimerChip />
        </ActiveTimerProvider>,
      );
    });
    await settle();

    expect(document.body.textContent).toContain("New focus task");
    expect(mocks.readActiveTimerSnapshotAction).not.toHaveBeenCalled();
  });

  it("ignores an older same-route server snapshot after a newer confirmation", async () => {
    mount();
    await settle();

    await act(async () => {
      root.render(
        <ActiveTimerProvider
          ownerUserId="owner-a"
          initialResult={activeResult(
            {
              ...session,
              sessionId: "session-2",
              taskTitle: "Newer focus task",
            },
            "2026-11-14T10:10:00.000Z",
          )}
        >
          <FloatingTimerChip />
        </ActiveTimerProvider>,
      );
    });
    await settle();
    expect(document.body.textContent).toContain("Newer focus task");

    await act(async () => {
      root.render(
        <ActiveTimerProvider
          ownerUserId="owner-a"
          initialResult={activeResult(session, "2026-11-14T10:05:00.000Z")}
        >
          <FloatingTimerChip />
        </ActiveTimerProvider>,
      );
    });
    await settle();

    expect(document.body.textContent).toContain("Newer focus task");
    expect(document.body.textContent).not.toContain("Ship the floating timer");
  });

  it("discards an in-flight read that resolves after a committed stop", async () => {
    vi.useFakeTimers();
    const first = deferred<Awaited<ReturnType<typeof mocks.readActiveTimerSnapshotAction>>>();
    mocks.readActiveTimerSnapshotAction.mockReturnValueOnce(first.promise);

    mount();
    await settle();
    const onPayload = mocks.subscribe.mock.calls[0]?.[0] as (() => void) | undefined;

    await act(async () => {
      onPayload?.();
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.readActiveTimerSnapshotAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      buttonByLabel("Stop timer for Ship the floating timer")?.click();
    });
    await settle();
    expect(document.querySelector('[data-testid="floating-timer-chip"]')).toBeNull();

    await act(async () => {
      first.resolve(activeResult(session));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="floating-timer-chip"]')).toBeNull();
  });

  it("queues a realtime signal that arrives during an in-flight read", async () => {
    vi.useFakeTimers();
    const first = deferred<Awaited<ReturnType<typeof mocks.readActiveTimerSnapshotAction>>>();
    mocks.readActiveTimerSnapshotAction.mockReturnValueOnce(first.promise);

    mount();
    await settle();

    const onPayload = mocks.subscribe.mock.calls[0]?.[0] as (() => void) | undefined;

    await act(async () => {
      onPayload?.();
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.readActiveTimerSnapshotAction).toHaveBeenCalledTimes(1);

    // The second signal debounces while the first read is still in flight.
    await act(async () => {
      onPayload?.();
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.readActiveTimerSnapshotAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(activeResult(null));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.readActiveTimerSnapshotAction).toHaveBeenCalledTimes(2);
  });

  it("defers a hidden-opener realtime refresh when no popout is owned", async () => {
    vi.useFakeTimers();
    mount();
    await settle();
    setHidden(true);

    const onPayload = mocks.subscribe.mock.calls[0]?.[0] as (() => void) | undefined;
    await act(async () => {
      onPayload?.();
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.readActiveTimerSnapshotAction).not.toHaveBeenCalled();
  });

  it("opens the pinned popout, stops that exact session, and tears down on native close", async () => {
    vi.useFakeTimers();
    const popout = installPopoutApi();
    mount();
    await settle();

    await act(async () => {
      buttonByLabel("Pop out timer to an always-on-top window")?.click();
    });
    await settle();

    expect(popout.document.body.textContent).toContain("Ship the floating timer");
    expect(popout.document.body.textContent).toContain("Running now");
    expect(
      document.body.textContent,
    ).toContain("Focus window");

    const popoutStop = popout.document.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop timer for Ship the floating timer"]',
    );
    await act(async () => {
      popoutStop?.click();
    });
    await settle();

    expect(mocks.stopActiveTimerSessionAction).toHaveBeenCalledWith("session-1");
    expect(popout.document.body.textContent).toContain("Session ended");
  });

  it("tears down the owned popout on native close and restores the chip control", async () => {
    vi.useFakeTimers();
    const popout = installPopoutApi();
    mount();
    await settle();

    await act(async () => {
      buttonByLabel("Pop out timer to an always-on-top window")?.click();
    });
    await settle();
    expect(document.body.textContent).toContain("Focus window");

    await act(async () => {
      popout.close();
    });
    await settle();

    expect(document.body.textContent).toContain("Pop out");
    expect(
      buttonByLabel("Pop out timer to an always-on-top window"),
    ).not.toBeUndefined();
  });

  it("marks the visible popout stopped after a remote stop while the opener is hidden", async () => {
    vi.useFakeTimers();
    const popout = installPopoutApi();
    mount();
    await settle();

    await act(async () => {
      buttonByLabel("Pop out timer to an always-on-top window")?.click();
    });
    await settle();
    setHidden(true);

    const onPayload = mocks.subscribe.mock.calls[0]?.[0] as (() => void) | undefined;
    await act(async () => {
      onPayload?.();
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.readActiveTimerSnapshotAction).toHaveBeenCalledTimes(1);
    expect(popout.document.body.textContent).toContain("Session ended");
    expect(
      popout.document.querySelector(
        'button[aria-label="Stop timer for Ship the floating timer"]',
      ),
    ).toBeNull();
  });

  it("marks the last known state stale after the 10 second sync timeout", async () => {
    vi.useFakeTimers();
    mocks.readActiveTimerSnapshotAction.mockReturnValueOnce(
      new Promise(() => {}) as never,
    );
    mount();
    await settle();

    const onPayload = mocks.subscribe.mock.calls[0]?.[0] as (() => void) | undefined;
    await act(async () => {
      onPayload?.();
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Timer sync delayed");
    expect(document.body.textContent).toContain("Timer sync timed out");
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
