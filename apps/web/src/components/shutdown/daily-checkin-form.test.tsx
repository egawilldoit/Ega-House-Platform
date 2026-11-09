// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DailyCheckinForm } from "./daily-checkin-form";
import type { DailyCheckin } from "@ega/domain/checkins";

const CHECKIN: DailyCheckin = {
  localDate: "2026-02-16",
  timezone: "Africa/Casablanca",
  outcomes: "Shipped the planner",
  personalMinutes: 45,
  notes: null,
  overtimeMinutes: 30,
  overtimeReason: "Release window",
  routine: null,
  createdAt: "2026-02-16T20:00:00.000Z",
  updatedAt: "2026-02-16T20:00:00.000Z",
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DailyCheckinForm", () => {
  it("submits the check-in when the save button is clicked", async () => {
    await act(async () => {
      root.render(
        <DailyCheckinForm checkin={null} defaultLocalDate="2026-02-16" action={vi.fn(async () => {})} returnTo="/shutdown" />,
      );
    });
    const submitted = vi.fn((event: Event) => event.preventDefault());
    container.querySelector("form")!.addEventListener("submit", submitted);
    const save = [...container.querySelectorAll("button")].find(button => button.textContent === "Save check-in");
    expect(save).toBeDefined();
    await act(async () => save!.click());
    expect(submitted).toHaveBeenCalledOnce();
  });

  it("prefills the saved check-in and submits bounded qualitative fields only", async () => {
    const action = vi.fn(async () => {});
    await act(async () => {
      root.render(
        <DailyCheckinForm
          checkin={CHECKIN}
          defaultLocalDate="2026-02-16"
          action={action}
          returnTo="/shutdown"
        />,
      );
    });

    const outcomes = container.querySelector<HTMLTextAreaElement>("#checkin-outcomes");
    expect(outcomes?.value).toBe("Shipped the planner");
    expect(container.querySelector<HTMLInputElement>("#checkin-personal-minutes")?.value).toBe("45");
    expect(container.querySelector<HTMLInputElement>("#checkin-overtime-minutes")?.value).toBe("30");
    expect(container.querySelector<HTMLInputElement>("#checkin-overtime-reason")?.value).toBe("Release window");
    expect(container.textContent).toContain("Saved check-in loaded.");

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    const names = [...form!.querySelectorAll("[name]")].map((node) => node.getAttribute("name"));
    // No timer hours or task ids are ever submitted with the check-in.
    expect(names).not.toContain("timerHours");
    expect(names).not.toContain("taskId");
    expect(names).toContain("localDate");
    expect(names).toContain("overtimeReason");
  });

  it("renders an empty check-in for a day without one", async () => {
    await act(async () => {
      root.render(
        <DailyCheckinForm
          checkin={null}
          defaultLocalDate="2026-02-16"
          action={vi.fn(async () => {})}
          returnTo="/shutdown"
        />,
      );
    });

    expect(container.querySelector<HTMLInputElement>("#checkin-date")?.value).toBe("2026-02-16");
    expect(container.querySelector<HTMLTextAreaElement>("#checkin-outcomes")?.value).toBe("");
    expect(container.textContent).not.toContain("Saved check-in loaded.");
  });
});
