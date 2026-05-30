import assert from "node:assert/strict";
import { describe, test, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";

import { OwnerScopedRealtimeRefresh } from "./owner-scoped-realtime-refresh";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPayload = Record<string, any>;
// Track calls to relevant functions
const routerRefreshCalls: number[] = [];
const subscribeCalls: {
  ownerUserId: string;
  tables: readonly string[];
  channelPrefix: string;
  onPayload: ((payload: RealtimePostgresChangesPayload<AnyPayload>) => void) | null;
}[] = [];
let unsubscribedCount = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeOnPayload: ((payload: any) => void) | null = null;

// Mock the dependencies before any imports that use them
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {
      routerRefreshCalls.push(Date.now());
    },
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ channel: () => {} }),
}));

// Set up a more complete mock for subscribeToOwnerScopedRealtimeChanges
// that actually captures the onPayload callback
vi.mock("@/lib/supabase/realtime", () => {
  return {
    getRealtimePayloadUpdatedAt: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: any,
    ) => {
      const newVal = payload.new?.updated_at as string | undefined;
      if (newVal) return newVal;
      const oldVal = payload.old?.updated_at as string | undefined;
      return oldVal ?? null;
    },
    subscribeToOwnerScopedRealtimeChanges: (
      _client: unknown,
      config: {
        ownerUserId: string;
        tables: readonly string[];
        channelPrefix: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onPayload: (payload: any) => void;
      },
    ) => {
      subscribeCalls.push({
        ownerUserId: config.ownerUserId,
        tables: config.tables,
        channelPrefix: config.channelPrefix,
        onPayload: config.onPayload,
      });
      activeOnPayload = config.onPayload;
      return () => {
        unsubscribedCount++;
        activeOnPayload = null;
      };
    },
  };
});

function resetMocks() {
  routerRefreshCalls.length = 0;
  subscribeCalls.length = 0;
  unsubscribedCount = 0;
  activeOnPayload = null;
}

function createPayload(
  eventType: "INSERT" | "UPDATE" | "DELETE",
  overrides: Partial<Record<string, unknown>> = {},
  table?: string,
): RealtimePostgresChangesPayload<Record<string, unknown>> {
  return {
    commit_timestamp: "2026-04-18T00:00:00.000Z",
    errors: [],
    eventType,
    schema: "public",
    table: table ?? "task_sessions",
    new: { owner_user_id: "user-1", updated_at: "2026-04-18T00:01:00.000Z", ...overrides },
    old: {},
  } as unknown as RealtimePostgresChangesPayload<Record<string, unknown>>;
}

describe("OwnerScopedRealtimeRefresh", () => {
  let rootElement: HTMLDivElement;
  let reactRoot: Root;

  beforeEach(() => {
    resetMocks();
    vi.useFakeTimers();
    // Simulate document being visible by default
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    reactRoot = createRoot(rootElement);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetMocks();
    document.body.removeChild(rootElement);
  });

  function mount(props: Parameters<typeof OwnerScopedRealtimeRefresh>[0]) {
    act(() => {
      reactRoot.render(
        React.createElement(OwnerScopedRealtimeRefresh, props),
      );
    });
  }

  function unmount() {
    act(() => {
      reactRoot.unmount();
    });
  }

  test("subscribes with correct owner and tables when ownerUserId is provided", () => {
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: ["task_sessions", "tasks"],
    });

    assert.equal(subscribeCalls.length, 1);
    assert.equal(subscribeCalls[0]!.ownerUserId, "user-1");
    assert.deepEqual(subscribeCalls[0]!.tables, ["task_sessions", "tasks"]);
    assert.equal(subscribeCalls[0]!.channelPrefix, "dashboard");
  });

  test("does not subscribe when ownerUserId is null", () => {
    mount({
      ownerUserId: null,
      channelPrefix: "dashboard",
      tables: ["task_sessions"],
    });

    assert.equal(subscribeCalls.length, 0);
  });

  test("does not subscribe when tables is empty", () => {
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: [],
    });

    assert.equal(subscribeCalls.length, 0);
  });

  test("calls router.refresh() after debounce interval on payload", () => {
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: ["task_sessions"],
      refreshDebounceMs: 1000,
    });

    assert.ok(activeOnPayload);

    // Fire a payload
    act(() => {
      activeOnPayload!(createPayload("INSERT"));
    });

    // Should not refresh immediately
    assert.equal(routerRefreshCalls.length, 0);

    // Advance time partially
    act(() => {
      vi.advanceTimersByTime(500);
    });
    assert.equal(routerRefreshCalls.length, 0);

    // Advance to end of debounce
    act(() => {
      vi.advanceTimersByTime(501);
    });
    assert.equal(routerRefreshCalls.length, 1);
  });

  test("debounce: bursts of multiple payloads only trigger one refresh", () => {
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: ["task_sessions"],
      refreshDebounceMs: 1000,
    });

    assert.ok(activeOnPayload);

    // Fire multiple payloads in quick succession
    act(() => {
      activeOnPayload!(createPayload("INSERT", { updated_at: "2026-04-18T00:01:00.000Z" }));
      activeOnPayload!(createPayload("UPDATE", { updated_at: "2026-04-18T00:02:00.000Z" }));
      activeOnPayload!(createPayload("UPDATE", { updated_at: "2026-04-18T00:03:00.000Z" }));
    });

    // Only one timeout should be active
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    assert.equal(routerRefreshCalls.length, 1);
  });

  test("never calls router.refresh() after unmount", () => {
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: ["task_sessions"],
      refreshDebounceMs: 500,
    });

    assert.ok(activeOnPayload);
    act(() => {
      activeOnPayload!(createPayload("INSERT"));
    });

    unmount();

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(501);
    });
    assert.equal(routerRefreshCalls.length, 0);
  });

  test("skips router.refresh() when document is hidden", () => {
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: ["task_sessions"],
      refreshDebounceMs: 500,
    });

    // Set document hidden
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });

    assert.ok(activeOnPayload);
    act(() => {
      activeOnPayload!(createPayload("INSERT"));
    });

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(501);
    });
    assert.equal(routerRefreshCalls.length, 0);
  });

  test("calls router.refresh() when document becomes visible again (subsequent payload)", () => {
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: ["task_sessions"],
      refreshDebounceMs: 500,
    });

    assert.ok(activeOnPayload);

    // First payload while hidden
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    act(() => {
      activeOnPayload!(createPayload("INSERT", { updated_at: "2026-04-18T00:01:00.000Z" }));
    });
    act(() => {
      vi.advanceTimersByTime(501);
    });
    assert.equal(routerRefreshCalls.length, 0);

    // Second payload while visible
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    act(() => {
      activeOnPayload!(createPayload("UPDATE", { updated_at: "2026-04-18T00:02:00.000Z" }));
    });
    act(() => {
      vi.advanceTimersByTime(501);
    });
    assert.equal(routerRefreshCalls.length, 1);
  });

  test("cleanup: clears timeout and unsubscribes on unmount", () => {
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: ["task_sessions"],
    });

    assert.ok(activeOnPayload);
    act(() => {
      activeOnPayload!(createPayload("INSERT"));
    });

    assert.equal(unsubscribedCount, 0);

    unmount();

    // Should have unsubscribed
    assert.equal(unsubscribedCount, 1);

    // Timeout should have been cleared so no refresh
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    assert.equal(routerRefreshCalls.length, 0);
  });

  test("uses default debounce of 1000ms", () => {
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: ["task_sessions"],
    });

    assert.ok(activeOnPayload);
    act(() => {
      activeOnPayload!(createPayload("INSERT"));
    });

    // At 999ms, should not have fired
    act(() => {
      vi.advanceTimersByTime(999);
    });
    assert.equal(routerRefreshCalls.length, 0);

    // At 1000ms, should fire
    act(() => {
      vi.advanceTimersByTime(1);
    });
    assert.equal(routerRefreshCalls.length, 1);
  });

  test("table/event filtering: filters by event type", () => {
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: ["task_sessions"],
      refreshDebounceMs: 100,
      eventFilter: {
        events: ["DELETE"],
      },
    });

    assert.ok(activeOnPayload);

    // INSERT should be filtered out
    act(() => {
      activeOnPayload!(createPayload("INSERT"));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    assert.equal(routerRefreshCalls.length, 0);

    // DELETE should trigger refresh
    act(() => {
      activeOnPayload!(createPayload("DELETE"));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    assert.equal(routerRefreshCalls.length, 1);
  });

  test("table/event filtering: filters by table", () => {
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: ["task_sessions", "tasks"],
      refreshDebounceMs: 100,
      eventFilter: {
        tables: ["tasks"],
      },
    });

    assert.ok(activeOnPayload);

    // task_sessions event should be filtered out
    act(() => {
      activeOnPayload!(createPayload("INSERT", {}, "task_sessions"));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    assert.equal(routerRefreshCalls.length, 0);

    // tasks event should trigger refresh
    act(() => {
      activeOnPayload!(createPayload("UPDATE", {}, "tasks"));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    assert.equal(routerRefreshCalls.length, 1);
  });

  test("skips refresh when payload has stale updated_at", () => {
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: ["task_sessions"],
      refreshDebounceMs: 100,
    });

    assert.ok(activeOnPayload);

    // First payload with later timestamp
    act(() => {
      activeOnPayload!(createPayload("UPDATE", { updated_at: "2026-04-18T00:05:00.000Z" }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    assert.equal(routerRefreshCalls.length, 1);

    // Second payload with earlier timestamp should be skipped
    act(() => {
      activeOnPayload!(createPayload("UPDATE", { updated_at: "2026-04-18T00:03:00.000Z" }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    assert.equal(routerRefreshCalls.length, 1);
  });

  test("the isMountedRef prevents stale callbacks after rapid remounts", () => {
    // Simulate a fast re-render cycle
    mount({
      ownerUserId: "user-1",
      channelPrefix: "dashboard",
      tables: ["task_sessions"],
      refreshDebounceMs: 500,
    });

    const firstOnPayload = activeOnPayload;
    assert.ok(firstOnPayload);

    // Unmount first instance
    unmount();

    // Create a new root for the second mount
    const rootElement2 = document.createElement("div");
    document.body.appendChild(rootElement2);
    const reactRoot2 = createRoot(rootElement2);

    act(() => {
      reactRoot2.render(
        React.createElement(OwnerScopedRealtimeRefresh, {
          ownerUserId: "user-1",
          channelPrefix: "dashboard",
          tables: ["task_sessions"],
          refreshDebounceMs: 500,
        }),
      );
    });

    // The old onPayload should still have a reference to the old closure,
    // but the component's isMountedRef should be false after unmount.
    // Fire from old subscriber (simulating a stale closure edge case)
    assert.ok(firstOnPayload);
    act(() => {
      firstOnPayload(createPayload("INSERT", { updated_at: "2026-04-18T00:01:00.000Z" }));
    });
    act(() => {
      vi.advanceTimersByTime(501);
    });

    // Old closure's timeout should not fire
    const refreshCountAfterStale = routerRefreshCalls.length;

    // Fire from new subscriber - should work
    assert.ok(activeOnPayload);
    act(() => {
      activeOnPayload!(createPayload("INSERT", { updated_at: "2026-04-18T00:02:00.000Z" }));
    });
    act(() => {
      vi.advanceTimersByTime(501);
    });

    // The stale one should NOT have fired (0), but the new one should fire
    // So total should be 1
    assert.equal(refreshCountAfterStale, 0);
    assert.equal(routerRefreshCalls.length, 1);

    act(() => {
      reactRoot2.unmount();
    });
    document.body.removeChild(rootElement2);
  });
});
