// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceErrorFallback } from "./workspace-error-fallback";

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
  vi.restoreAllMocks();
});

describe("WorkspaceErrorFallback", () => {
  it("uses retry for Try again when provided", () => {
    const reset = vi.fn();
    const retry = vi.fn();
    act(() => root.render(<WorkspaceErrorFallback reset={reset} retry={retry} scopeLabel="Favourites" />));
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Try again");
    act(() => button?.click());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("falls back to reset when retry is not provided", () => {
    const reset = vi.fn();
    act(() => root.render(<WorkspaceErrorFallback reset={reset} scopeLabel="Favourites" />));
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Try again");
    act(() => button?.click());
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("uses the default home destination", () => {
    act(() => root.render(<WorkspaceErrorFallback reset={() => {}} scopeLabel="Favourites" />));
    const homeLink = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Go to Home");
    expect(homeLink?.getAttribute("href")).toBe("/");
  });
});
