// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/tasks" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("./sidebar", () => ({ Sidebar: () => null }));
vi.mock("./sidebar-mobile-drawer", () => ({ SidebarMobileDrawer: () => null }));
vi.mock("./top-bar", () => ({ TopBar: () => null }));
vi.mock("./offline-banner", () => ({ OfflineBanner: () => null }));

import { WorkspaceShell } from "./workspace-shell";
import type { ComponentProps } from "react";

it("does not remount retained page content merely to replay the entrance animation", () => {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function RetainedContent() {
    useEffect(() => { mounted(); return unmounted; }, []);
    return <input defaultValue="Draft" aria-label="Draft" />;
  }
  const props = {
    title: "Tasks",
    metrics: { hasActiveTimer: false, timerState: "idle", blockedTaskCount: 0, overdueTaskCount: 0, dueTodayTaskCount: 0, unreadNotificationCount: 0, reviewMissing: false, reviewSignal: "current", taskActionCount: 0, totalActionCount: 0, highestPrioritySignal: "clear" },
    identity: { id: null, name: "EGA", email: "ega@example.com", initials: "EG" },
  } satisfies Omit<ComponentProps<typeof WorkspaceShell>, "children">;
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(<WorkspaceShell {...props}><RetainedContent /></WorkspaceShell>));
    const input = container.querySelector("input")!;
    input.value = "Unsaved draft";
    route.pathname = "/today";
    act(() => root.render(<WorkspaceShell {...props}><RetainedContent /></WorkspaceShell>));
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("Unsaved draft");
  } finally {
    act(() => root.unmount());
    route.pathname = "/tasks";
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});
