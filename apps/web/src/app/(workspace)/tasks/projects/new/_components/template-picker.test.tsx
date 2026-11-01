// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TemplatePicker, type TemplatePickerOption } from "./template-picker";

const OPTIONS: TemplatePickerOption[] = [
  {
    id: "blank",
    name: "Blank",
    summary: "Start empty.",
    projectDescription: "",
    goalCount: 0,
    taskCount: 0,
    goals: [],
  },
  {
    id: "feature-release",
    name: "Feature release",
    summary: "Scope, build, ship.",
    projectDescription: "Ship one feature.",
    goalCount: 1,
    taskCount: 2,
    goals: [
      {
        title: "Scope",
        description: "Agree the finish line.",
        tasks: [
          { title: "Write acceptance criteria", dueDate: "2027-03-14", priority: "high", estimateMinutes: 45 },
          { title: "Split into tasks", dueDate: "2027-03-16", priority: "medium", estimateMinutes: null },
        ],
      },
    ],
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderPicker(value = "blank", onChange = vi.fn()) {
  await act(async () => {
    root.render(<TemplatePicker options={OPTIONS} value={value} onChange={onChange} />);
  });
  return onChange;
}

describe("TemplatePicker", () => {
  it("is one native radio group with blank first and no preview rows for blank", async () => {
    await renderPicker();

    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios).toHaveLength(2);
    expect(new Set(radios.map((radio) => radio.name))).toEqual(new Set(["templateId"]));
    expect(radios[0]?.value).toBe("blank");
    expect(radios[0]?.checked).toBe(true);
    expect(container.textContent).toContain("No goals or tasks will be created");
    expect(container.textContent).not.toContain("Write acceptance criteria");
  });

  it("renders the selected template's goals, tasks, resolved dates and counts", async () => {
    await renderPicker("feature-release");

    expect(container.textContent).toContain("What will be created");
    expect(container.textContent).toContain("1 goal · 2 tasks");
    expect(container.textContent).toContain("Scope");
    expect(container.textContent).toContain("Write acceptance criteria");
    expect(container.textContent).toContain("Due Mar 14");
    expect(container.textContent).toContain("Due Mar 16");

    const selected = container.querySelector<HTMLInputElement>('input[value="feature-release"]');
    expect(selected?.checked).toBe(true);
  });

  it("reports selection changes through onChange (click is equivalent to keyboard select)", async () => {
    const onChange = await renderPicker();

    await act(async () => {
      container.querySelector<HTMLInputElement>('input[value="feature-release"]')?.click();
    });

    expect(onChange).toHaveBeenCalledWith("feature-release");
  });
});
