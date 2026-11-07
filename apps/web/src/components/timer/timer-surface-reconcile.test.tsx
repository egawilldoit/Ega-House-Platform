// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  routerRefresh: vi.fn(),
  reconcileTimerSurface: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      href,
      children,
    }: {
      href: string;
      children: React.ReactNode;
    }) => React.createElement("a", { href }, children),
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ channel: () => {} }),
}));

vi.mock("@/lib/supabase/realtime", () => ({
  getRealtimePayloadUpdatedAt: (
    payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  ) => {
    const value =
      "updated_at" in payload.new ? payload.new.updated_at : undefined;
    return typeof value === "string" ? value : null;
  },
  subscribeToOwnerScopedRealtimeChanges: (
    _client: unknown,
    config: {
      onPayload: (
        payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
      ) => void;
    },
  ) => {
    mocks.subscribe(config.onPayload);
    return () => {};
  },
}));

vi.mock("@/lib/timer/reconcile-action", () => ({
  reconcileTimerSurface: mocks.reconcileTimerSurface,
}));

import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { TimerSyncStatus } from "./timer-sync-status";

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

function payload() {
  return {
    commit_timestamp: "2026-11-07T12:00:00.000Z",
    errors: [],
    eventType: "UPDATE",
    schema: "public",
    table: "task_sessions",
    new: {
      owner_user_id: "owner-a",
      updated_at: "2026-11-07T12:00:00.000Z",
    },
    old: {},
  } as unknown as RealtimePostgresChangesPayload<Record<string, unknown>>;
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
      <>
        <OwnerScopedRealtimeRefresh
          ownerUserId="owner-a"
          channelPrefix="timer"
          tables={["task_sessions"]}
          reconcileOnVisibility={false}
        />
        <TimerSyncStatus surface="timer" ownerUserId="owner-a" />
      </>,
    );
  });
}

async function fire(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  setHidden(false);
  vi.useFakeTimers();
  mocks.routerRefresh.mockReset();
  mocks.reconcileTimerSurface.mockReset();
  mocks.subscribe.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Timer surface reconcile ownership", () => {
  it("drops the hidden realtime payload in favor of exactly one verified reconcile on visibility", async () => {
    const pending = deferred<{ ok: true; syncedAt: string; activeSessionId: null }>();
    mocks.reconcileTimerSurface.mockReturnValue(pending.promise);

    mount();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    const onPayload = mocks.subscribe.mock.calls[0]?.[0] as
      | ((value: ReturnType<typeof payload>) => void)
      | undefined;
    expect(onPayload).toBeDefined();

    setHidden(true);
    act(() => {
      onPayload?.(payload());
      vi.advanceTimersByTime(1000);
    });
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
    expect(mocks.reconcileTimerSurface).not.toHaveBeenCalled();

    // Re-entry burst: visibility + focus + online must produce one action and
    // zero router.refresh from the realtime component.
    setHidden(false);
    await fire(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });

    expect(mocks.reconcileTimerSurface).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileTimerSurface).toHaveBeenCalledWith("timer");
    expect(mocks.routerRefresh).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({
        ok: true,
        syncedAt: "2026-11-07T12:00:05.000Z",
        activeSessionId: null,
      });
      await Promise.resolve();
    });
  });

  it("still refreshes on a visible realtime payload", async () => {
    mocks.reconcileTimerSurface.mockResolvedValue({
      ok: true,
      syncedAt: "2026-11-07T12:00:00.000Z",
      activeSessionId: null,
    });

    mount();
    const onPayload = mocks.subscribe.mock.calls[0]?.[0] as
      | ((value: ReturnType<typeof payload>) => void)
      | undefined;

    await act(async () => {
      onPayload?.(payload());
      vi.advanceTimersByTime(1000);
    });

    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
    // A visible payload does not trigger the verified reconcile path.
    expect(mocks.reconcileTimerSurface).not.toHaveBeenCalled();
  });
});
