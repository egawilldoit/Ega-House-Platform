import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IdeaNote, IdeaNoteProjectOption } from "@/lib/services/idea-note-service";

import { BacklogItemForm } from "./backlog-item-form";

vi.mock("./actions", () => ({
  updateBacklogItemAction: vi.fn(
    async (): Promise<{ error: null; success: string }> => ({ error: null, success: "Backlog item updated." }),
  ),
}));

const projectOptions: IdeaNoteProjectOption[] = [
  { id: "project-1", name: "EGA House" },
  { id: "project-2", name: "Side Project" },
];

function buildNote(overrides: Partial<IdeaNote> = {}): IdeaNote {
  return {
    id: "note-1",
    title: "Review the onboarding flow",
    body: null,
    status: "inbox",
    type: "idea",
    project_id: null,
    priority: null,
    tags: [],
    created_at: "2026-09-27T00:00:00.000Z",
    updated_at: "2026-09-27T00:00:00.000Z",
    ...overrides,
  };
}

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

function renderForm(note: IdeaNote) {
  act(() => {
    root.render(<BacklogItemForm note={note} projectOptions={projectOptions} />);
  });
  const form = container.querySelector("form");
  if (!form) throw new Error("BacklogItemForm did not render a form");
  return form;
}

function hiddenStatusValue(form: HTMLFormElement): string | null {
  return form.querySelector('input[name="status"]')?.getAttribute("value") ?? null;
}

describe("BacklogItemForm hidden status preservation (EGA-659)", () => {
  it("ega-659: keeps a manual reviewing status instead of resetting it to inbox", () => {
    const form = renderForm(buildNote({ status: "reviewing" }));
    expect(hiddenStatusValue(form)).toBe("reviewing");
  });

  it("ega-659: keeps a manual planned status instead of resetting it to inbox", () => {
    const form = renderForm(buildNote({ status: "planned" }));
    expect(hiddenStatusValue(form)).toBe("planned");
  });

  it("ega-659: keeps inbox status", () => {
    const form = renderForm(buildNote({ status: "inbox" }));
    expect(hiddenStatusValue(form)).toBe("inbox");
  });

  it("ega-659: keeps archived status", () => {
    const form = renderForm(buildNote({ status: "archived" }));
    expect(hiddenStatusValue(form)).toBe("archived");
  });

  it("ega-659: falls back to inbox for non-manual statuses such as converted", () => {
    const form = renderForm(buildNote({ status: "converted" }));
    expect(hiddenStatusValue(form)).toBe("inbox");
  });

  it("ega-659: preserves legacy type, priority, and tags alongside manual status", () => {
    const form = renderForm(
      buildNote({ status: "planned", type: "feature", priority: "high", tags: ["beta"] }),
    );
    expect(hiddenStatusValue(form)).toBe("planned");
    expect(form.querySelector('input[name="type"]')?.getAttribute("value")).toBe("feature");
    expect(form.querySelector('input[name="priority"]')?.getAttribute("value")).toBe("high");
    expect(form.querySelector('input[name="tagsInput"]')?.getAttribute("value")).toBe("beta");
  });
});
