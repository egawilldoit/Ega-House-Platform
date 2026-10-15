import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InlineTaskUpdateForm } from "./inline-task-update-form";

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

function buttonByText(label: string) {
  return Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  ) as HTMLButtonElement;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("InlineTaskUpdateForm delete confirmation", () => {
  it("Cancel does not submit, Confirm submits delete action", async () => {
    const action = vi.fn();
    const deleteAction = vi.fn();
    await act(async () => {
      root.render(
        <InlineTaskUpdateForm
          action={action}
          deleteAction={deleteAction}
          taskId="task-1"
          taskTitle="Draft weekly execution review"
          returnTo="/tasks"
          defaultStatus="todo"
          defaultPriority="high"
          defaultDueDate={null}
          defaultEstimateMinutes={null}
          defaultScheduledStartAt={null}
          defaultScheduledEndAt={null}
          defaultCalendarSyncEnabled={false}
          defaultCalendarReminderMinutes={10}
          defaultBlockedReason={null}
        />,
      );
    });

    const trigger = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="task-inline-delete-task-1"]',
    )!;
    await click(trigger);
    expect(document.body.textContent).toContain("Draft weekly execution review");

    const cancel = buttonByText("Cancel");
    await click(cancel);
    await act(async () => {});
    expect(deleteAction).not.toHaveBeenCalled();

    await click(trigger);
    const confirm = buttonByText("Confirm");
    await click(confirm);
    await act(async () => {});
    expect(deleteAction).toHaveBeenCalled();
  });
});
