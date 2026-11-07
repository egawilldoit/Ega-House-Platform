// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";

import { DEFAULT_PERSONAL_OPERATIONS } from "@ega/domain";

vi.mock("./actions", () => ({
  updatePersonalOperationsAction: async () => ({ message: "", ok: false }),
}));

import { PersonalOperationsForm } from "./personal-operations-form";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const ARCHIVED_TASK_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_TASK_ID = "33333333-3333-4333-8333-333333333333";

function renderForm(initialReference: { kind: "task"; id: string } | null = null) {
  return (
    <PersonalOperationsForm
      initial={DEFAULT_PERSONAL_OPERATIONS}
      initialReference={initialReference}
      disabled={false}
      referenceOptions={{
        tasks: [
          { id: TASK_ID, title: "Apply to roles", archivedAt: null },
          { id: ARCHIVED_TASK_ID, title: "Old applications", archivedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }}
    />
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PersonalOperationsForm job-search reference", () => {
  it("offers task options, labels archived tasks, and the schedule JSON is 3-key", () => {
    const markup = renderToStaticMarkup(renderForm());

    expect(markup).toContain("Job-search work reference");
    expect(markup).toContain('<optgroup label="Tasks">');
    expect(markup).not.toContain('<optgroup label="Projects">');
    expect(markup).toContain("Old applications (archived)");
    expect(markup).toContain(`task:${TASK_ID}`);
    expect(markup).toContain('name="jobSearchReferenceDirty" value="false"');
    const scheduleJson = markup.match(/name="schedule" value="([^"]+)"/)?.[1] ?? "";
    expect(scheduleJson).not.toContain("jobSearchReference");
  });

  it("keeps a configured task that is missing from the fetched options", () => {
    const markup = renderToStaticMarkup(renderForm({ kind: "task", id: MISSING_TASK_ID }));

    expect(markup).toContain('<optgroup label="Current selection">');
    expect(markup).toContain(`task:${MISSING_TASK_ID}`);
    expect(markup).toContain("not in the current list");
  });

  it("marks the reference dirty only when the owner changes it", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(renderForm());
    });

    const dirty = () => container.querySelector<HTMLInputElement>('input[name="jobSearchReferenceDirty"]')!;
    const select = () => container.querySelector<HTMLSelectElement>('select[name="jobSearchReference"]')!;
    expect(dirty().value).toBe("false");

    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(select(), `task:${TASK_ID}`);
      select().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(dirty().value).toBe("true");
    expect(select().value).toBe(`task:${TASK_ID}`);

    await act(async () => {
      setter.call(select(), "");
      select().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(dirty().value).toBe("true");
    expect(select().value).toBe("");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
