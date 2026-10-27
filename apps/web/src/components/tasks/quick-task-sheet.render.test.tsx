// @vitest-environment jsdom
import { act } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hooks/use-display-timezone", () => ({
  useDisplayTimezone: () => "UTC",
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

function setValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, next: string) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
  descriptor?.set?.call(element, next);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function change(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, next: string) {
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

describe("QuickTaskSheetPanel command token overrides", () => {
  it("keeps manually overridden goal/priority/status/estimate/due after an ordinary title edit", async () => {
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
          initialCommand="Fix bug #Alpha high 45m @blocked:waiting today"
        />
          </DialogPrimitive.Content>
        </DialogPrimitive.Root>,
      );
    });

    await change(field("quick-task-goal"), "g1");
    await change(field("quick-task-priority"), "low");
    await change(field("quick-task-status"), "todo");
    await change(field("quick-task-estimate"), "90");
    await change(field("quick-task-due-date"), "2026-12-01");
    // Keep the blocked-reason field happy if it appears.
    await act(async () => {});

    expect(field("quick-task-goal").value).toBe("g1");
    expect(field("quick-task-priority").value).toBe("low");
    expect(field("quick-task-status").value).toBe("todo");
    expect(field("quick-task-estimate").value).toBe("90");
    expect(field("quick-task-due-date").value).toBe("2026-12-01");

    await change(field("quick-task-command"), "Fix bug #Alpha high 45m @blocked:waiting today x");

    expect(field("quick-task-goal").value).toBe("g1");
    expect(field("quick-task-priority").value).toBe("low");
    expect(field("quick-task-status").value).toBe("todo");
    expect(field("quick-task-estimate").value).toBe("90");
    expect(field("quick-task-due-date").value).toBe("2026-12-01");
  });

  it("keeps a manually selected project despite a stale project token", async () => {
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
          initialCommand="Fix bug #Alpha"
        />
          </DialogPrimitive.Content>
        </DialogPrimitive.Root>,
      );
    });

    await change(field("quick-task-project"), "beta");
    expect(field("quick-task-project").value).toBe("beta");

    await change(field("quick-task-command"), "Fix bug #Alpha x");

    expect(field("quick-task-project").value).toBe("beta");
  });

  it("still applies a parsed token after it changes", async () => {
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
          initialCommand="Fix bug"
        />
          </DialogPrimitive.Content>
        </DialogPrimitive.Root>,
      );
    });

    expect(field("quick-task-priority").value).toBe("medium");

    await change(field("quick-task-command"), "Fix bug high");

    expect(field("quick-task-priority").value).toBe("high");
  });
});
