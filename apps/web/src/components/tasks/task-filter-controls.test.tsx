import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

import { TaskFilterControls } from "./task-filter-controls";

let container: HTMLDivElement;
let root: Root;

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

function renderControls() {
  return act(async () => {
    root.render(
      <TaskFilterControls
        basePath="/tasks"
        activeStatus="in_progress"
        activePriority="high"
        activeEstimateMin={30}
        activeEstimateMax={120}
        activeDueWithin={7}
        activeTasksOnly
        activeDueFilter="overdue"
        activeSort="due_date_asc"
        activeView="archived"
        activeLayout="kanban"
        projectOptions={[{ id: "p1", name: "EGA House" }]}
        goalOptions={[{ id: "g1", title: "Launch" }]}
      />,
    );
  });
}

describe("TaskFilterControls compact toolbar (EGA-650)", () => {
  it("renders a collapsed filter trigger with active chips and sort visible", async () => {
    await renderControls();

    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="tasks-filter-trigger"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    // Options are behind the disclosure, not rendered while collapsed.
    expect(container.querySelector('[role="region"][aria-label="Task filter options"]')).toBeNull();

    // Active filters are visible and removable.
    const chips = container.querySelector('[data-testid="tasks-active-filters"]');
    expect(chips?.textContent).toContain("Active tasks only");
    expect(chips?.textContent).toContain("Due within 7d");
    expect(chips?.textContent).toContain("Estimate: 30m–120m");
    expect(container.querySelector('[data-testid="tasks-filter-clear"]')).not.toBeNull();

    // Sort stays immediately accessible.
    expect(container.querySelector('[role="group"][aria-label="Sort tasks"]')).not.toBeNull();
  });

  it("opens the filter panel and preserves advanced filters in option links", async () => {
    await renderControls();

    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="tasks-filter-trigger"]');
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    const panel = container.querySelector('[role="region"][aria-label="Task filter options"]');
    expect(panel).not.toBeNull();

    // The status option link keeps every other active dimension.
    const statusLink = Array.from(panel!.querySelectorAll("a")).find((anchor) =>
      anchor.textContent?.includes("Todo"),
    ) as HTMLAnchorElement | undefined;
    expect(statusLink).toBeDefined();
    const search = new URL(statusLink!.getAttribute("href") ?? "", "https://egawilldoit.online").searchParams;
    expect(search.get("status")).toBe("todo");
    expect(search.get("estimateMin")).toBe("30");
    expect(search.get("estimateMax")).toBe("120");
    expect(search.get("dueWithin")).toBe("7");
    expect(search.get("tasks")).toBe("active");
    expect(search.get("priority")).toBe("high");
    expect(search.get("archive")).toBe("archived");
    expect(search.get("layout")).toBe("kanban");
  });
});
