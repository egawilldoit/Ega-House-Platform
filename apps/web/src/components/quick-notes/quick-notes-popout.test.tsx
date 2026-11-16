// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readActiveTimerSnapshotAction: vi.fn(),
  stopActiveTimerSessionAction: vi.fn(),
  captureInboxIdea: vi.fn(),
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
    default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
      React.createElement("a", { href, ...props }, children),
  };
});

vi.mock("@/app/(workspace)/active-timer-actions", () => ({
  readActiveTimerSnapshotAction: mocks.readActiveTimerSnapshotAction,
  stopActiveTimerSessionAction: mocks.stopActiveTimerSessionAction,
}));

vi.mock("@/components/inbox/capture-action", () => ({
  captureInboxIdea: mocks.captureInboxIdea,
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

import { ActiveTimerProvider, useActiveTimer } from "@/components/timer/floating-timer/active-timer-provider";
import { FloatingTimerChip } from "@/components/timer/floating-timer/floating-timer-chip";
import {
  QuickNotesLauncher,
  QuickNotesPanel,
} from "./quick-notes-launcher";
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

function TestControls() {
  const { quickNotes } = useActiveTimer();
  return (
    <button
      data-testid="set-notes-text"
      onClick={() => quickNotes.setText("first line\nsecond line")}
    />
  );
}

let container: HTMLDivElement;
let root: Root;

function installPopoutApi() {
  const popoutDocument = document.implementation.createHTMLDocument("popout");
  const requestWindow = vi.fn(async () => target);
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
    value: { requestWindow },
  });

  return { target, requestWindow };
}

function mount(active: ActiveTimerSessionSnapshot | null = session) {
  act(() => {
    root.render(
      <ActiveTimerProvider
        ownerUserId="owner-a"
        initialResult={{
          ok: true,
          syncedAt: "2026-11-14T10:05:00.000Z",
          session: active,
        }}
      >
        <FloatingTimerChip />
        <QuickNotesLauncher />
        <QuickNotesPanel />
        <TestControls />
      </ActiveTimerProvider>,
    );
  });
}

function clickByLabel(label: string, doc: Document = document) {
  const button = Array.from(doc.querySelectorAll("button")).find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  );
  act(() => {
    button?.click();
  });
  return button;
}

function clickTestId(testId: string) {
  act(() => {
    document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.readActiveTimerSnapshotAction.mockReset();
  mocks.stopActiveTimerSessionAction.mockReset();
  mocks.captureInboxIdea.mockReset();
  mocks.routerRefresh.mockReset();
  mocks.subscribe.mockReset();
  mocks.readActiveTimerSnapshotAction.mockResolvedValue({
    ok: true,
    syncedAt: "2026-11-14T10:05:00.000Z",
    session: null,
  });
  mocks.stopActiveTimerSessionAction.mockResolvedValue({ ok: true });
  mocks.captureInboxIdea.mockResolvedValue({ ok: true, id: "note-1" });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as { documentPictureInPicture?: unknown }).documentPictureInPicture;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("shared Timer + Notes popout", () => {
  it("opens notes without a timer and preserves the draft across native close and reopen", async () => {
    const { target, requestWindow } = installPopoutApi();
    mount(null);
    await settle();

    clickByLabel("Open Quick notes");
    expect(document.querySelector('[data-testid="quick-notes-panel"]')).not.toBeNull();
    clickTestId("set-notes-text");

    clickByLabel("Pop out Quick Notes to an always-on-top window");
    await settle();

    expect(requestWindow).toHaveBeenCalledTimes(1);
    expect(target.document.body.textContent).toContain("Quick notes");
    expect(
      target.document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Quick notes scratchpad"]',
      )?.value,
    ).toBe("first line\nsecond line");
    expect(mocks.stopActiveTimerSessionAction).not.toHaveBeenCalled();
    // One visible editor: the in-app panel closes once the PiP window opens.
    expect(document.querySelector('[data-testid="quick-notes-panel"]')).toBeNull();

    act(() => {
      target.close();
    });
    await settle();

    // Native close never discards the draft; reopening the panel restores it.
    expect(document.querySelector('[data-testid="quick-notes-panel"]')).toBeNull();
    clickByLabel("Open Quick notes");
    expect(
      document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Quick notes scratchpad"]',
      )?.value,
    ).toBe("first line\nsecond line");

    clickByLabel("Pop out Quick Notes to an always-on-top window");
    await settle();
    expect(requestWindow).toHaveBeenCalledTimes(2);
    expect(
      target.document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Quick notes scratchpad"]',
      )?.value,
    ).toBe("first line\nsecond line");
  });

  it("focuses the existing timer window and shows both surfaces", async () => {
    const { target, requestWindow } = installPopoutApi();
    mount();
    await settle();

    clickByLabel("Pop out timer to an always-on-top window");
    await settle();
    expect(target.document.body.textContent).toContain("Ship the floating timer");

    clickByLabel("Open Quick notes");
    // The window is already open, so the control becomes "Focus window".
    clickByLabel("Focus always-on-top Quick Notes window");
    await settle();

    expect(requestWindow).toHaveBeenCalledTimes(1);
    expect(target.focus).toHaveBeenCalled();
    expect(target.document.body.textContent).toContain("Quick notes");
    expect(target.document.body.textContent).toContain("Ship the floating timer");
    expect(
      target.document.querySelector('button[aria-label="Stop timer for Ship the floating timer"]'),
    ).not.toBeNull();
  });

  it("shows a timer started after notes in the same window and never stops it on close", async () => {
    const { target, requestWindow } = installPopoutApi();
    mount(null);
    await settle();

    clickByLabel("Open Quick notes");
    clickByLabel("Pop out Quick Notes to an always-on-top window");
    await settle();
    expect(requestWindow).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(
        <ActiveTimerProvider
          ownerUserId="owner-a"
          initialResult={{
            ok: true,
            syncedAt: "2026-11-14T10:06:00.000Z",
            session,
          }}
        >
          <FloatingTimerChip />
          <QuickNotesLauncher />
          <TestControls />
        </ActiveTimerProvider>,
      );
    });
    await settle();

    expect(target.document.body.textContent).toContain("Ship the floating timer");
    expect(target.document.body.textContent).toContain("Quick notes");

    clickByLabel("Focus always-on-top timer window");
    expect(requestWindow).toHaveBeenCalledTimes(1);

    act(() => {
      target.close();
    });
    await settle();
    expect(mocks.stopActiveTimerSessionAction).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="floating-timer-chip"]')).not.toBeNull();
  });

  it("saves from the popout editor through the canonical capture action", async () => {
    const { target } = installPopoutApi();
    mount(null);
    await settle();

    clickByLabel("Open Quick notes");
    clickTestId("set-notes-text");
    clickByLabel("Pop out Quick Notes to an always-on-top window");
    await settle();

    const saveButton = Array.from(target.document.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "Save note to Backlog",
    );
    expect((saveButton as HTMLButtonElement)?.disabled).toBe(false);

    await act(async () => {
      saveButton?.click();
    });
    await settle();

    expect(mocks.captureInboxIdea).toHaveBeenCalledTimes(1);
    expect(mocks.captureInboxIdea.mock.calls[0]?.[0]).toMatchObject({
      title: "first line",
      body: "first line\nsecond line",
    });
    expect(target.document.body.textContent).toContain("Saved to Backlog");
    expect(
      target.document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Quick notes scratchpad"]',
      )?.value,
    ).toBe("");
  });
});
