// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams("layout=timeline"),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { buildTimelineModel, resolveTimelineRange } from "@/lib/task-timeline";

import { TaskTimeline, type TimelineScheduleActionState } from "./task-timeline";

const range = resolveTimelineRange("2026-05-20");
const model = buildTimelineModel(
  [
    {
      id: "task-a",
      title: "Draft plan",
      status: "todo",
      start_date: "2026-05-20",
      due_date: "2026-05-21",
      updatedAt: "2026-05-19T10:00:00.000Z",
    },
    {
      id: "task-b",
      title: "Review plan",
      status: "in_progress",
      start_date: "2026-05-22",
      due_date: "2026-05-24",
      updatedAt: "2026-05-19T11:00:00.000Z",
    },
    {
      id: "task-c",
      title: "Undated task",
      status: "todo",
      start_date: null,
      due_date: "2026-05-23",
    },
  ],
  [{ taskId: "task-b", blockedByTaskId: "task-a" }],
  range,
);

let container: HTMLDivElement;
let root: Root;
const action = vi.fn(
  async (
    _state: TimelineScheduleActionState,
    _formData: FormData,
  ): Promise<TimelineScheduleActionState> => ({
    errorMessage: null,
    successMessage: "Dates updated.",
    taskId: "task-a",
  }),
);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  refresh.mockClear();
  action.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function render() {
  act(() =>
    root.render(
      <TaskTimeline
        model={model}
        range={range}
        zoom="week"
        today="2026-05-20"
        returnTo="/tasks?layout=timeline"
        action={action}
      />,
    ),
  );
}

describe("TaskTimeline", () => {
  it("renders bars, arrows and a text/list alternative", () => {
    render();

    const bars = document.body.querySelectorAll('[data-testid^="timeline-bar-"]');
    expect(bars).toHaveLength(2);
    expect(document.body.querySelector("svg path")).not.toBeNull();
    expect(document.body.textContent).toContain("Review plan is blocked by Draft plan.");
    expect(document.body.textContent).toContain("Undated task");
    expect(document.body.textContent).toContain("No start");
  });

  it("moves a bar with the keyboard through the versioned action", async () => {
    render();
    const bar = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="timeline-bar-task-a"]',
    );
    expect(bar).not.toBeNull();

    await act(async () => {
      bar?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });

    expect(action).toHaveBeenCalledTimes(1);
    const formData = action.mock.calls[0]?.[1] as FormData;
    expect(formData.get("taskId")).toBe("task-a");
    expect(formData.get("startDate")).toBe("2026-05-21");
    expect(formData.get("dueDate")).toBe("2026-05-22");
    expect(formData.get("expectedUpdatedAt")).toBe("2026-05-19T10:00:00.000Z");
  });

  it("opens the non-drag date editor from the keyboard", async () => {
    render();
    const bar = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="timeline-bar-task-a"]',
    );

    await act(async () => {
      bar?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    const dateInputs = document.body.querySelectorAll<HTMLInputElement>('input[type="date"]');
    expect(dateInputs).toHaveLength(2);
    expect(dateInputs[0]?.value).toBe("2026-05-20");
    expect(dateInputs[1]?.value).toBe("2026-05-21");
    expect(document.body.textContent).toContain("Edit dates for");
  });
});
