import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildWorkspaceShellMetrics } from "@/lib/workspace-shell";

vi.mock("next/image", () => ({
  default: (props: { alt: string; className?: string; height: number; src: string; width: number }) =>
    createElement("img", props),
}));

vi.mock("lucide-react", () => ({
  Inbox: () => <svg aria-hidden="true" />,
  PanelLeftClose: () => <svg aria-hidden="true" />,
  PanelLeftOpen: () => <svg aria-hidden="true" />,
  Search: () => <svg aria-hidden="true" />,
}));

vi.mock("@/components/inbox/inbox-capture-trigger", () => ({
  InboxCaptureTrigger: () => <button type="button">Capture</button>,
}));

vi.mock("./sidebar-create-task", () => ({
  SidebarCreateTaskButton: () => <button type="button">Create task</button>,
}));

vi.mock("./sidebar-navigation", () => ({
  SidebarNavigation: ({ compact }: { compact?: boolean }) => (
    <nav data-testid="sidebar-navigation" data-compact={String(Boolean(compact))} />
  ),
}));

vi.mock("./workspace-search-trigger", () => ({
  WorkspaceSearchTrigger: () => <button type="button">Search</button>,
}));

import { Sidebar } from "./sidebar";

let container: HTMLDivElement;
let root: Root;
let hadActEnvironment = false;
let previousActEnvironment: boolean | undefined;
const actEnvironmentGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const metrics = buildWorkspaceShellMetrics({
  hasActiveTimer: false,
  blockedTaskCount: 0,
  overdueTaskCount: 0,
  dueTodayTaskCount: 0,
  hasCurrentWeekReview: true,
});

/** Mirrors the real shell boundary: the frame owns the collapse state. */
function ControlledSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  return <Sidebar metrics={metrics} collapsed={collapsed} onCollapsedChange={setCollapsed} />;
}

beforeEach(() => {
  hadActEnvironment = Object.prototype.hasOwnProperty.call(actEnvironmentGlobal, "IS_REACT_ACT_ENVIRONMENT");
  previousActEnvironment = actEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;
  actEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (hadActEnvironment) {
    actEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  } else {
    delete actEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;
  }
});

describe("Sidebar collapse control", () => {
  it("toggles the data state and navigation compact mode", async () => {
    await act(async () => {
      root.render(<ControlledSidebar />);
    });

    const sidebar = container.querySelector<HTMLElement>(".workspace-sidebar");
    const toggle = container.querySelector<HTMLButtonElement>("[data-testid=sidebar-collapse-toggle]");
    const navigation = container.querySelector<HTMLElement>("[data-testid=sidebar-navigation]");
    expect(sidebar?.dataset.collapsed).toBe("false");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(navigation?.dataset.compact).toBe("false");

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(sidebar?.dataset.collapsed).toBe("true");
    expect(toggle?.getAttribute("aria-label")).toBe("Expand sidebar");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(navigation?.dataset.compact).toBe("true");
  });
});
