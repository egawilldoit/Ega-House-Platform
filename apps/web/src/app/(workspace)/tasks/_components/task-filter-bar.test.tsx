// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { TaskFilterBar } from "./task-filter-bar";

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

async function render() {
  await act(async () => {
    root.render(
      <TaskFilterBar
        view="active"
        search="review"
        status="in_progress"
        project="project-1"
        due="overdue"
        projects={[
          { id: "project-1", name: "EGA House" },
          { id: "project-2", name: "Growth" },
        ]}
        returnTo="/tasks"
      />,
    );
  });
}

describe("TaskFilterBar", () => {
  it("is one GET form with exactly Search, Status, Project and Due controls", async () => {
    await render();

    const form = container.querySelector<HTMLFormElement>(
      '[data-testid="task-filter-bar"]',
    );
    expect(form?.method).toBe("get");
    expect(form?.getAttribute("action")).toBe("/tasks");

    expect(container.querySelector('input[name="q"]')?.getAttribute("value")).toBe(
      "review",
    );
    expect(container.querySelectorAll("select").length).toBe(3);
    expect(
      container.querySelector<HTMLSelectElement>('select[name="status"]')?.value,
    ).toBe("in_progress");
    expect(
      container.querySelector<HTMLSelectElement>('select[name="project"]')?.value,
    ).toBe("project-1");
    expect(
      container.querySelector<HTMLSelectElement>('select[name="due"]')?.value,
    ).toBe("overdue");
  });

  it("preserves the archived scope through a hidden view field", async () => {
    await act(async () => {
      root.render(
        <TaskFilterBar
          view="archived"
          search=""
          status={null}
          project={null}
          due="all"
          projects={[]}
          returnTo="/tasks?view=archived"
        />,
      );
    });

    const hidden = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="view"]',
    );
    expect(hidden?.value).toBe("archived");
  });

  it("offers a clear affordance back to the unfiltered list", async () => {
    await render();

    const clear = Array.from(container.querySelectorAll("a")).find((anchor) =>
      anchor.textContent?.includes("Clear"),
    );
    expect(clear?.getAttribute("href")).toBe("/tasks");
  });
});
