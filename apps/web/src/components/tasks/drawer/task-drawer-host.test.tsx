// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
let currentParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh }),
  usePathname: () => "/tasks",
  useSearchParams: () => currentParams,
}));

import { TaskDrawerHost } from "./task-drawer-host";

const TASK = {
  id: "t1",
  title: "Draft weekly execution review",
  description: "Existing description",
  status: "in_progress",
  priority: "high",
  start_date: null as string | null,
  due_date: "2026-05-01",
  estimate_minutes: 90,
  blocked_reason: null as string | null,
  project_id: "p1",
  goal_id: "g1",
  archived_at: null as string | null,
  tracked_seconds: 5400 as number | null,
  has_open_session: false,
  dependencies: {
    blockedBy: [],
    blocking: [],
    options: [],
  },
  dependencyError: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockClear();
  replace.mockClear();
  currentParams = new URLSearchParams();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

/** React tracks the last value it wrote; set through the native setter first. */
function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

const updateFieldAction = vi.fn();
const updateDraftAction = vi.fn(async (_state: unknown, _formData: FormData) => ({
  errorMessage: null,
  successMessage: null,
  savedValue: null,
}));
const dependencyAction = vi.fn();

function render(
  task: typeof TASK | null,
  loadFailed = false,
  extra: { updateError?: string | null; updateSuccess?: string | null } = {},
) {
  act(() =>
    root.render(
      <TaskDrawerHost
        task={task}
        loadFailed={loadFailed}
        updateFieldAction={updateFieldAction}
        updateDraftAction={updateDraftAction}
        ownerId="owner-1"
        addDependencyAction={dependencyAction}
        removeDependencyAction={dependencyAction}
        {...extra}
      />,
    ),
  );
}

describe("TaskDrawerHost", () => {
  it("renders nothing when no task is selected in the URL", () => {
    render(TASK);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("mounts the comments tab with a count, safe body and reaction controls", () => {
    currentParams = new URLSearchParams("task=t1");
    const action = vi.fn(async () => ({ ok: true, errorMessage: null }));
    act(() =>
      root.render(
        <TaskDrawerHost
          task={TASK}
          updateFieldAction={updateFieldAction}
          updateDraftAction={updateDraftAction}
          addDependencyAction={dependencyAction}
          removeDependencyAction={dependencyAction}
          ownerId="owner-1"
          activity={[]}
          comments={[
            {
              id: "c1",
              taskId: "t1",
              body: "Hello **@codex**",
              author: { kind: "agent", ref: "agent:codex", label: "Codex" },
              mentions: [{ kind: "agent", ref: "agent:codex", label: "Codex" }],
              reactions: [{ emoji: "👍", count: 1, reactedByViewer: false }],
              createdAt: "2026-10-28T10:00:00.000Z",
              updatedAt: "2026-10-28T10:00:00.000Z",
              editedAt: null,
              viewerCanEdit: false,
              viewerCanDelete: false,
            },
          ]}
          commentMentions={[
            { kind: "owner", ref: "owner", handle: "owner", label: "You (owner)" },
          ]}
          commentActions={{
            createAction: action,
            updateAction: action,
            deleteAction: action,
            toggleReactionAction: action,
          }}
        />,
      ),
    );

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Comments 1");
    expect(dialog?.textContent).toContain("Codex");
    expect(dialog?.textContent).toContain("@codex");
    expect(dialog?.querySelector('button[aria-pressed][aria-label*="reaction"]')).not.toBeNull();
  });

  it("shows the selected task with its status, priority and due date", () => {
    currentParams = new URLSearchParams("task=t1&layout=board");
    render(TASK);

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Draft weekly execution review");

    const selects = Array.from(document.body.querySelectorAll<HTMLSelectElement>("select"));
    // Status and priority are inline editors now; assert the bound values.
    expect(selects.map((select) => select.value)).toEqual(["in_progress", "high"]);
    const dueDate = document.body.querySelector<HTMLInputElement>('input[aria-label="Due date"]');
    expect(dueDate?.value).toBe("2026-05-01");
    const startDate = document.body.querySelector<HTMLInputElement>('input[aria-label="Start date"]');
    expect(startDate?.value).toBe("");
  });

  it("edits the title, description and estimate in place", () => {
    currentParams = new URLSearchParams("task=t1");
    render(TASK);

    const title = document.body.querySelector<HTMLInputElement>('input[maxlength="256"]');
    expect(title?.value).toBe("Draft weekly execution review");

    const description = document.body.querySelector<HTMLTextAreaElement>("textarea");
    expect(description?.value).toBe("Existing description");

    const estimate = document.body.querySelector<HTMLInputElement>('input[type="number"][name="value"]');
    expect(estimate?.value).toBe("90");
    expect(estimate?.form?.querySelector<HTMLInputElement>('input[name="field"]')?.value).toBe(
      "estimateMinutes",
    );
  });

  it("offers a blocked reason editor only while the task is blocked", () => {
    currentParams = new URLSearchParams("task=t1");
    render({ ...TASK, status: "blocked", blocked_reason: "Waiting on review" });

    const reasonForm = Array.from(
      document.body.querySelectorAll<HTMLInputElement>('input[name="field"]'),
    )
      .map((input) => input.form)
      .find(
        (form) =>
          form?.querySelector<HTMLInputElement>('input[name="field"]')?.value === "blockedReason",
      );
    expect(reasonForm).toBeTruthy();
    expect(reasonForm?.querySelector<HTMLInputElement>('input[name="value"]')?.value).toBe(
      "Waiting on review",
    );

    // A non-blocked task must not offer an editor that can only fail validation.
    act(() => root.unmount());
    root = createRoot(container);
    render(TASK);
    const fields = Array.from(
      document.body.querySelectorAll<HTMLInputElement>('input[name="field"]'),
    ).map((input) => input.value);
    expect(fields).not.toContain("blockedReason");
  });

  it("keeps a typed title when the server refreshes while it is dirty", () => {
    currentParams = new URLSearchParams("task=t1");
    render(TASK);

    const title = document.body.querySelector<HTMLInputElement>('input[maxlength="256"]');
    act(() => {
      if (title) setNativeValue(title, "My unsaved title");
    });

    // A realtime/RSC refresh hands the drawer a newer saved title.
    act(() => root.render(
      <TaskDrawerHost
        task={{ ...TASK, title: "Server changed this" }}
        updateFieldAction={updateFieldAction}
        updateDraftAction={updateDraftAction}
        addDependencyAction={dependencyAction}
        removeDependencyAction={dependencyAction}
      />,
    ));

    const after = document.body.querySelector<HTMLInputElement>('input[maxlength="256"]');
    expect(after?.value).toBe("My unsaved title");
  });

  it("confirms before discarding a dirty draft and keeps it when refused", () => {
    currentParams = new URLSearchParams("task=t1&layout=board");
    render(TASK);

    const description = document.body.querySelector<HTMLTextAreaElement>("textarea");
    act(() => {
      if (description) setNativeValue(description, "Half-written plan");
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const close = document.body.querySelector('[aria-label="Close task details"]');
    act(() => {
      (close as HTMLButtonElement).click();
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(document.body.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Half-written plan",
    );

    confirmSpy.mockReturnValue(true);
    act(() => {
      (close as HTMLButtonElement).click();
    });
    expect(replace).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("keeps a rejected draft and shows the field error", async () => {
    currentParams = new URLSearchParams("task=t1");
    updateDraftAction.mockResolvedValueOnce({
      errorMessage: "Title is too long.",
      successMessage: null,
      savedValue: null,
    } as never);
    render(TASK);

    const title = document.body.querySelector<HTMLInputElement>('input[maxlength="256"]');
    act(() => {
      if (title) setNativeValue(title, "Renamed");
    });
    const save = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Save title",
    );
    await act(async () => {
      (save as HTMLButtonElement).click();
    });

    expect(document.body.querySelector<HTMLInputElement>('input[maxlength="256"]')?.value).toBe(
      "Renamed",
    );
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "Title is too long.",
    );
  });

  it("shows an indistinguishable unavailable state for a missing task", () => {
    currentParams = new URLSearchParams("task=missing-id");
    render(null);

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Task unavailable");
    expect(dialog?.textContent).toContain("may have been deleted");
  });

  it("reports an operational failure distinctly from a missing task", () => {
    currentParams = new URLSearchParams("task=t1");
    render(null, true);

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Unable to load this task right now.");
    expect(dialog?.textContent).not.toContain("may have been deleted");

    const retry = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again",
    );
    act(() => {
      (retry as HTMLButtonElement).click();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("submits exactly one changed field with the drawer context", async () => {
    currentParams = new URLSearchParams("task=t1&layout=board");
    render(TASK);
    updateFieldAction.mockClear();

    const statusSelect = document.body.querySelector<HTMLSelectElement>('select[name="value"]');
    expect(statusSelect).not.toBeNull();
    const form = statusSelect?.form as HTMLFormElement;
    expect(form.querySelector<HTMLInputElement>('input[name="field"]')?.value).toBe("status");
    expect(form.querySelector<HTMLInputElement>('input[name="taskId"]')?.value).toBe("t1");

    await act(async () => {
      if (statusSelect) statusSelect.value = "done";
      form.requestSubmit();
    });

    expect(updateFieldAction).toHaveBeenCalledTimes(1);
    const submitted = updateFieldAction.mock.calls[0][0] as FormData;
    expect(submitted.get("field")).toBe("status");
    expect(submitted.get("value")).toBe("done");
    expect(submitted.get("taskId")).toBe("t1");
    expect(String(submitted.get("returnTo"))).toContain("task=t1");
  });

  it("does not auto-submit when a value changes", async () => {
    currentParams = new URLSearchParams("task=t1");
    render(TASK);
    updateFieldAction.mockClear();

    const select = document.body.querySelector<HTMLSelectElement>('select[name="value"]');
    await act(async () => {
      if (select) select.value = "done";
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(updateFieldAction).not.toHaveBeenCalled();
  });

  it("stops offering blocked when the task has no blocked reason", () => {
    currentParams = new URLSearchParams("task=t1");
    render(TASK);
    const options = Array.from(document.body.querySelectorAll<HTMLOptionElement>("option")).map(
      (option) => option.value,
    );
    expect(options).not.toContain("blocked");
  });

  it("shows the patch error inside the drawer, not only on the row", () => {
    currentParams = new URLSearchParams("task=t1");
    render(TASK, false, { updateError: "Blocked reason is required when status is Blocked." });
    const alert = document.body.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Blocked reason is required");
  });

  it("does not replay flash parameters from the current URL", () => {
    currentParams = new URLSearchParams("task=t1&taskUpdateError=old&taskUpdateTaskId=t1");
    render(TASK);
    const returnTo = document.body.querySelector<HTMLInputElement>('input[name="returnTo"]');
    expect(returnTo?.value).not.toContain("taskUpdateError");
    expect(returnTo?.value).toContain("task=t1");
  });

  it("closes by removing only the drawer parameters", () => {
    currentParams = new URLSearchParams("task=t1&layout=board&sort=due");
    render(TASK);

    const close = document.body.querySelector('[aria-label="Close task details"]');
    act(() => {
      (close as HTMLButtonElement).click();
    });

    expect(replace).toHaveBeenCalledTimes(1);
    const href = replace.mock.calls[0][0] as string;
    expect(href.startsWith("/tasks?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.has("task")).toBe(false);
    expect(params.get("layout")).toBe("board");
    expect(params.get("sort")).toBe("due");
  });
});

describe("TaskDrawer character shortcuts", () => {
  const press = (key: string) => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  };

  it("sets status from the explicit number mapping", async () => {
    currentParams = new URLSearchParams("task=t1");
    updateDraftAction.mockClear();
    render(TASK);

    await act(async () => {
      press("4");
      await Promise.resolve();
    });

    expect(updateDraftAction).toHaveBeenCalledTimes(1);
    const submitted = updateDraftAction.mock.calls[0][1] as FormData;
    expect(submitted.get("field")).toBe("status");
    expect(submitted.get("value")).toBe("done");
  });

  it("uses P as a prefix for priority and does not mutate on P alone", () => {
    currentParams = new URLSearchParams("task=t1");
    updateDraftAction.mockClear();
    render(TASK);

    press("p");

    expect(updateDraftAction).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Press 1 low");
  });

  it("refuses blocked without a reason instead of submitting an invalid patch", () => {
    currentParams = new URLSearchParams("task=t1");
    updateDraftAction.mockClear();
    render(TASK);

    press("5");

    expect(updateDraftAction).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("blocked reason");
  });

  it("ignores character shortcuts while typing in an editor", () => {
    currentParams = new URLSearchParams("task=t1");
    updateDraftAction.mockClear();
    render(TASK);

    const title = document.body.querySelector<HTMLInputElement>('input[maxlength="256"]');
    act(() => {
      title?.dispatchEvent(new KeyboardEvent("keydown", { key: "4", bubbles: true }));
    });

    expect(updateDraftAction).not.toHaveBeenCalled();
  });
});

describe("TaskDrawer subtasks", () => {
  const actions = {
    addAction: vi.fn(),
    toggleAction: vi.fn(),
    renameAction: vi.fn(),
    deleteAction: vi.fn(),
    moveAction: vi.fn(),
    promoteAction: vi.fn(),
  };

  it("shows progress, the ordered checklist and the add form", () => {
    currentParams = new URLSearchParams("task=t1");
    act(() =>
      root.render(
        <TaskDrawerHost
          task={TASK}
          updateFieldAction={updateFieldAction}
          updateDraftAction={updateDraftAction}
          addDependencyAction={dependencyAction}
          removeDependencyAction={dependencyAction}
          subtasks={[
            {
              id: "s1",
              taskId: "t1",
              title: "First item",
              done: true,
              position: 0,
              completedAt: "2026-10-27T10:00:00.000Z",
              createdAt: "2026-10-27T09:00:00.000Z",
              updatedAt: "2026-10-27T10:00:00.000Z",
            },
            {
              id: "s2",
              taskId: "t1",
              title: "Second item",
              done: false,
              position: 1,
              completedAt: null,
              createdAt: "2026-10-27T09:00:00.000Z",
              updatedAt: "2026-10-27T09:00:00.000Z",
            },
          ]}
          subtaskActions={actions}
        />,
      ),
    );

    expect(document.body.textContent).toContain("First item");
    expect(document.body.textContent).toContain("1/2");
    expect(
      document.body.querySelector<HTMLInputElement>('input[name="title"]')?.placeholder,
    ).toContain("Add a subtask");

    const toggle = document.body.querySelector(
      'button[aria-label="Complete Second item"]',
    );
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
  });

  it("does not render the checklist without the server action bundle", () => {
    currentParams = new URLSearchParams("task=t1");
    render(TASK);
    expect(document.body.textContent).not.toContain("Add a subtask");
  });
});

describe("TaskDrawer activity", () => {
  it("renders durable activity with honest actor attribution", () => {
    currentParams = new URLSearchParams("task=t1");
    act(() =>
      root.render(
        <TaskDrawerHost
          task={TASK}
          updateFieldAction={updateFieldAction}
          updateDraftAction={updateDraftAction}
          addDependencyAction={dependencyAction}
          removeDependencyAction={dependencyAction}
          activity={[
            {
              id: "a1",
              kind: "status",
              occurredAt: "2026-10-27T10:00:00.000Z",
              actor: { kind: "owner" },
              summary: "Status changed from todo to in progress",
            },
            {
              id: "a2",
              kind: "field_change",
              occurredAt: "2026-10-27T09:00:00.000Z",
              actor: { kind: "unknown" },
              summary: "Priority: medium → high",
            },
          ]}
        />,
      ),
    );

    expect(document.body.textContent).toContain("Status changed from todo to in progress");
    expect(document.body.textContent).toContain("You");
    expect(document.body.textContent).toContain("Unknown actor");
  });

  it("shows an explicit empty state instead of inventing history", () => {
    currentParams = new URLSearchParams("task=t1");
    render(TASK);
    expect(document.body.textContent).toContain("No activity recorded yet.");
  });
});
