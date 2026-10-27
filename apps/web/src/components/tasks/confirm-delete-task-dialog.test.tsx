// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmDeleteTaskButton } from "./confirm-delete-task-button";

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

function FormHarness({ deleteAction }: { deleteAction: (formData: FormData) => void | Promise<void> }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form action={deleteAction} ref={formRef}>
      <input type="hidden" name="taskId" value="task-1" />
      <input type="hidden" name="confirmDelete" value="true" />
      <ConfirmDeleteTaskButton
        taskTitle="saas meeting cdc"
        formRef={formRef}
        dataTestId="shared-delete-task-1"
      />
    </form>
  );
}

function textButton(label: string) {
  return Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  ) as HTMLButtonElement;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("ConfirmDeleteTaskButton", () => {
  it("names the task, Cancel does not submit, Confirm submits the existing form", async () => {
    const deleteAction = vi.fn();
    await act(async () => {
      root.render(<FormHarness deleteAction={deleteAction} />);
    });

    const trigger = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="shared-delete-task-1"]',
    )!;
    await click(trigger);

    expect(document.body.textContent).toContain("saas meeting cdc");

    const cancel = textButton("Cancel");
    await click(cancel);
    await act(async () => {});
    expect(deleteAction).not.toHaveBeenCalled();

    await click(trigger);
    const confirm = textButton("Confirm");
    await click(confirm);
    await act(async () => {});
    expect(deleteAction).toHaveBeenCalled();
    const formData = deleteAction.mock.calls[0][0] as FormData;
    expect(formData.get("taskId")).toBe("task-1");
    expect(formData.get("confirmDelete")).toBe("true");
  });
});
