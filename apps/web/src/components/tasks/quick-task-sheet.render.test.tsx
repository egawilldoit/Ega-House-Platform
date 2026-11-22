// @vitest-environment jsdom
import { act } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hooks/use-display-timezone", () => ({
  useDisplayTimezone: () => "UTC",
}));

vi.mock("@/app/(workspace)/tasks/actions", () => ({
  createTaskAction: vi.fn(),
}));

import { QuickTaskSheetPanel } from "./quick-task-sheet";

const projects = [
  { id: "alpha", name: "Alpha" },
  { id: "beta", name: "Beta" },
];

const goals = [
  { id: "g1", title: "Goal One", project_id: "alpha" },
  { id: "g2", title: "Goal Two", project_id: "beta" },
];

let container: HTMLDivElement;
let root: Root;

function setValue(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  next: string,
) {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element),
    "value",
  );
  descriptor?.set?.call(element, next);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function change(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  next: string,
) {
  await act(async () => {
    setValue(element, next);
  });
}

function field(id: string) {
  return container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`) as
    | HTMLInputElement
    | HTMLSelectElement;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container.remove();
});

async function renderPanel(initialCommand = "") {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <DialogPrimitive.Root open>
        <DialogPrimitive.Content>
          <QuickTaskSheetPanel
            projects={projects}
            goals={goals}
            activeTab="single"
            onTabChange={() => {}}
            onSuccess={() => {}}
            selectedProjectId="alpha"
            initialCommand={initialCommand}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Root>,
    );
  });
}

describe("QuickTaskSheetPanel lean capture", () => {
  it("keeps a manually selected project when the title changes", async () => {
    await renderPanel("Fix bug");

    await change(field("quick-task-project"), "beta");
    expect(field("quick-task-project").value).toBe("beta");

    await change(field("quick-task-command"), "Fix bug in beta");

    expect(field("quick-task-project").value).toBe("beta");
    expect(field("quick-task-command").value).toBe("Fix bug in beta");
  });

  it("keeps priority and due date out of the title text", async () => {
    await renderPanel("Fix bug");

    await change(field("quick-task-priority"), "high");
    await change(field("quick-task-due-date"), "2026-12-01");
    await change(field("quick-task-command"), "Fix bug today");

    expect(field("quick-task-command").value).toBe("Fix bug today");
    expect(field("quick-task-priority").value).toBe("high");
    expect(field("quick-task-due-date").value).toBe("2026-12-01");
  });

  it("does not render a multi-draft surface", async () => {
    await renderPanel("Fix bug");

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.textContent).not.toContain("Create tasks");
  });
});
