import assert from "node:assert/strict";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeControl } from "./theme-control";
import { WORKSPACE_THEME_STORAGE_KEY } from "@/lib/theme-preference";
import { setWorkspaceThemePreference } from "@/lib/hooks/workspace-theme";

type MatchMediaFixture = {
  setDark: (value: boolean) => void;
};

function installMatchMedia(initialDark: boolean): MatchMediaFixture {
  let matches = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === "change") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === "change") listeners.delete(listener);
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => mediaQueryList,
  });

  return {
    setDark(value) {
      matches = value;
      for (const listener of listeners) {
        listener({ matches: value, media: mediaQueryList.media } as MediaQueryListEvent);
      }
    },
  };
}

let container: HTMLDivElement;
let root: Root;
let media: MatchMediaFixture;

function option(label: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".theme-control-option"));
  const button = buttons.find((entry) => entry.textContent?.includes(label));
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function openThemeMenu() {
  const details = container.querySelector<HTMLDetailsElement>(".theme-control");
  const summary = container.querySelector<HTMLElement>(".theme-control-trigger");
  assert.ok(details && summary);
  expect(details.open).toBe(false);
  await click(summary);
  expect(details.open).toBe(true);
  return details;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-preference");
  media = installMatchMedia(false);
  setWorkspaceThemePreference("system");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<ThemeControl />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
});

describe("ThemeControl", () => {
  it("renders three labelled choices with the system default active", () => {
    const summary = container.querySelector<HTMLElement>(".theme-control-trigger");
    const buttons = container.querySelectorAll<HTMLButtonElement>(".theme-control-option");

    expect(summary?.getAttribute("aria-label")).toBe("Theme: System. Change theme");
    expect(buttons).toHaveLength(3);
    expect(Array.from(buttons).map((button) => button.textContent?.trim())).toEqual([
      "Light",
      "Dark",
      "System",
    ]);
    expect(Array.from(buttons).every((button) => button.getAttribute("type") === "button")).toBe(true);
    expect(option("System").getAttribute("aria-pressed")).toBe("true");
    expect(option("Light").getAttribute("aria-pressed")).toBe("false");
    expect(option("Dark").getAttribute("aria-pressed")).toBe("false");
  });

  it("switches light → dark → light without navigation and persists the choice", async () => {
    await openThemeMenu();
    await click(option("Dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY)).toBe("dark");
    expect(option("Dark").getAttribute("aria-pressed")).toBe("true");
    expect(option("System").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(".theme-control")?.hasAttribute("open")).toBe(false);

    await openThemeMenu();
    await click(option("Light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY)).toBe("light");
    expect(option("Light").getAttribute("aria-pressed")).toBe("true");
  });


  it("keeps the selected theme when the shell remounts on client navigation", async () => {
    await openThemeMenu();
    await click(option("Dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");

    await act(async () => root.unmount());
    container.remove();

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<ThemeControl />);
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(option("Dark").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".theme-control-trigger")?.getAttribute("aria-label")).toBe(
      "Theme: Dark. Change theme",
    );
  });

  it("returns to System and follows OS changes live", async () => {
    await openThemeMenu();
    await click(option("Dark"));
    await openThemeMenu();
    await click(option("System"));

    expect(document.documentElement.dataset.themePreference).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");

    await act(async () => {
      media.setDark(true);
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("system");
    expect(option("System").getAttribute("aria-pressed")).toBe("true");
  });

  it("closes the disclosure on Escape and returns focus to the trigger", async () => {
    const details = await openThemeMenu();
    const summary = container.querySelector<HTMLElement>(".theme-control-trigger");
    assert.ok(summary);

    summary.focus();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it("does not steal focus from an unrelated control when Escape closes the menu", async () => {
    const details = await openThemeMenu();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("server-renders the deterministic System state for hydration", () => {
    const markup = renderToStaticMarkup(<ThemeControl />);

    expect(markup).toContain('aria-label="Theme: System. Change theme"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup.match(/type="button"/g)?.length).toBe(3);
    expect(markup).toContain("System");
  });
});
