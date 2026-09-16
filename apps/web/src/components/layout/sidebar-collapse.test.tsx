import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildWorkspaceShellMetrics } from "@/lib/workspace-shell";

vi.mock("next/image", () => ({
  default: (props: { alt: string; className?: string; height: number; src: string; width: number }) =>
    createElement("img", props),
}));

vi.mock("lucide-react", () => ({
  PanelLeftClose: () => <svg aria-hidden="true" />,
  PanelLeftOpen: () => <svg aria-hidden="true" />,
}));

vi.mock("@/components/inbox/inbox-quick-capture", () => ({
  InboxQuickCapture: () => <button type="button">Capture</button>,
}));

vi.mock("./sidebar-navigation", () => ({
  SidebarNavigation: ({ compact }: { compact?: boolean }) => (
    <nav data-testid="sidebar-navigation" data-compact={String(Boolean(compact))} />
  ),
}));

import { Sidebar } from "./sidebar";

let container: HTMLDivElement;
let root: Root;

const metrics = buildWorkspaceShellMetrics({
  hasActiveTimer: false,
  blockedTaskCount: 0,
  overdueTaskCount: 0,
  dueTodayTaskCount: 0,
  hasCurrentWeekReview: true,
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Sidebar collapse control", () => {
  it("toggles the data state and navigation compact mode", async () => {
    await act(async () => {
      root.render(<Sidebar metrics={metrics} />);
    });

    const sidebar = container.querySelector<HTMLElement>(".workspace-sidebar");
    const toggle = container.querySelector<HTMLButtonElement>("[data-testid=workspace-sidebar-collapse]");
    const navigation = container.querySelector<HTMLElement>("[data-testid=sidebar-navigation]");
    expect(sidebar?.dataset.collapsed).toBe("false");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(navigation?.dataset.compact).toBe("false");

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(sidebar?.dataset.collapsed).toBe("true");
    expect(toggle?.getAttribute("aria-label")).toBe("Expand workspace sidebar");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(navigation?.dataset.compact).toBe("true");
  });
});
