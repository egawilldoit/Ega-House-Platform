// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  loadNotificationsAction: vi.fn(),
  markNotificationReadAction: vi.fn(),
  openNotificationAction: vi.fn(),
  markAllNotificationsReadAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({}));

vi.mock("./notification-actions", () => actions);

import { NotificationBell } from "./notification-bell";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  actions.loadNotificationsAction.mockResolvedValue({
    ok: true,
    rows: [
      {
        id: "n1",
        title: "Reminder",
        body: "Review the task",
        createdAt: "2026-11-22T10:00:00.000Z",
        targetHref: "/tasks?view=all#task-t1",
        isUnread: true,
      },
    ],
    unreadCount: 1,
    nextCursor: "cursor-2",
  });
  actions.markNotificationReadAction.mockResolvedValue({ ok: true });
  actions.openNotificationAction.mockResolvedValue({ ok: true, href: "/tasks?view=all#task-t1" });
  actions.markAllNotificationsReadAction.mockResolvedValue({ ok: true, updatedCount: 1 });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

async function render(unread = 1) {
  await act(async () => {
    root.render(<NotificationBell initialUnreadCount={unread} />);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("NotificationBell", () => {
  it("reconciles the installed-PWA app badge from the unread count", async () => {
    const setAppBadge = vi.fn(async () => undefined);
    const clearAppBadge = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "setAppBadge", {
      configurable: true,
      value: setAppBadge,
    });
    Object.defineProperty(navigator, "clearAppBadge", {
      configurable: true,
      value: clearAppBadge,
    });

    await render(2);
    expect(setAppBadge).toHaveBeenCalledWith(2);

    await act(async () => {
      root.render(<NotificationBell initialUnreadCount={0} />);
    });
    expect(clearAppBadge).toHaveBeenCalledTimes(1);
  });

  it("exposes the unread state on the trigger", async () => {
    await render(2);
    const button = container.querySelector<HTMLButtonElement>(".topbar-notification");
    expect(button?.getAttribute("aria-label")).toBe("Notifications (2 unread)");
    expect(button?.getAttribute("data-has-unread")).toBe("true");
  });

  it("loads history on open and pages older notifications", async () => {
    await render();
    const trigger = container.querySelector<HTMLButtonElement>(".topbar-notification");
    if (!trigger) throw new Error("trigger missing");

    await act(async () => {
      trigger.click();
    });
    await flush();

    expect(actions.loadNotificationsAction).toHaveBeenCalledWith(null);
    expect(document.body.textContent).toContain("Reminder");
    expect(document.body.textContent).toContain("Load older notifications");

    const loadOlder = Array.from(document.body.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Load older notifications",
    );
    if (!loadOlder) throw new Error("load older missing");
    await act(async () => {
      loadOlder.click();
    });
    await flush();
    expect(actions.loadNotificationsAction).toHaveBeenLastCalledWith("cursor-2");
  });

  it("refreshes the history every time the bell is reopened", async () => {
    await render();

    const trigger = () => {
      const button = container.querySelector<HTMLButtonElement>(".topbar-notification");
      if (!button) throw new Error("trigger missing");
      return button;
    };

    await act(async () => {
      trigger().click();
    });
    await flush();
    expect(actions.loadNotificationsAction).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Reminder");

    // Dismiss, then land a notification that was created after the last open.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();
    actions.loadNotificationsAction.mockResolvedValueOnce({
      ok: true,
      rows: [
        {
          id: "n2",
          title: "New reminder",
          body: "A task became due",
          createdAt: "2026-11-22T11:00:00.000Z",
          targetHref: null,
          isUnread: true,
        },
      ],
      unreadCount: 2,
      nextCursor: null,
    });

    await act(async () => {
      trigger().click();
    });
    await flush();

    expect(actions.loadNotificationsAction).toHaveBeenCalledTimes(2);
    expect(actions.loadNotificationsAction).toHaveBeenLastCalledWith(null);
    expect(document.body.textContent).toContain("New reminder");
    expect(document.body.textContent).not.toContain("Reminder");
    expect(trigger().getAttribute("aria-label")).toBe("Notifications (2 unread)");
  });

  it("marks a row read locally and decrements the unread count", async () => {
    await render();
    const trigger = container.querySelector<HTMLButtonElement>(".topbar-notification");
    if (!trigger) throw new Error("trigger missing");
    await act(async () => {
      trigger.click();
    });
    await flush();

    const markRead = Array.from(document.body.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Mark read",
    );
    if (!markRead) throw new Error("mark read missing");
    await act(async () => {
      markRead.click();
    });
    await flush();

    expect(actions.markNotificationReadAction).toHaveBeenCalledWith("n1");
    expect(trigger.getAttribute("aria-label")).toBe("Notifications");
    expect(document.body.textContent).toContain("You are caught up.");
  });
});
