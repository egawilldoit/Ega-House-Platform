// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const status = vi.hoisted(() => ({ pending: false }));
vi.mock("react-dom", async (original) => ({
  ...await original<typeof import("react-dom")>(),
  useFormStatus: () => status,
}));
import { RemoveButton } from "./favourite-row-actions";

it("blocks another removal while the toggle is pending and recovers afterwards", () => {
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = globals.IS_REACT_ACT_ENVIRONMENT;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(<RemoveButton label="Remove favourite" />));
    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(false);
    status.pending = true;
    act(() => root.render(<RemoveButton label="Remove favourite" />));
    expect(button.disabled).toBe(true);
    status.pending = false;
    act(() => root.render(<RemoveButton label="Remove favourite" />));
    expect(button.disabled).toBe(false);
  } finally {
    act(() => root.unmount());
    status.pending = false;
    globals.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
