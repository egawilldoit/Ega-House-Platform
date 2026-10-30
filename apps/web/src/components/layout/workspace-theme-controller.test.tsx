// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspacePreferencesProvider, useWorkspacePreferences } from "./workspace-preferences-provider";
import { WorkspaceThemeController } from "./workspace-theme-controller";

type MatchMediaFixture = {
  setDark: (value: boolean) => void;
  listenerCount: () => number;
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
    listenerCount: () => listeners.size,
  };
}

function resetDocument() {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-preference");
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  resetDocument();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  resetDocument();
});

describe("WorkspaceThemeController", () => {
  it("applies an explicit choice over the OS and does not subscribe to OS changes", async () => {
    const media = installMatchMedia(true);

    await act(async () => {
      root.render(<WorkspaceThemeController preference="light" />);
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themePreference).toBe("light");
    expect(media.listenerCount()).toBe(0);

    media.setDark(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows live OS changes while the preference is System", async () => {
    const media = installMatchMedia(false);

    await act(async () => {
      root.render(<WorkspaceThemeController preference="system" />);
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(media.listenerCount()).toBe(1);

    await act(async () => {
      media.setDark(true);
    });
    expect(document.documentElement.dataset.theme).toBe("dark");

    await act(async () => {
      media.setDark(false);
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themePreference).toBe("system");
  });

  it("uses the new owner's preference on mount instead of a previous browser value", async () => {
    localStorage.setItem("ega-workspace-theme", "dark");
    installMatchMedia(true);

    await act(async () => {
      root.render(<WorkspaceThemeController preference="light" />);
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("ega-workspace-theme")).toBe("dark");
  });

  it("cleans up the OS subscription on unmount", async () => {
    const media = installMatchMedia(false);

    await act(async () => {
      root.render(<WorkspaceThemeController preference="system" />);
    });
    expect(media.listenerCount()).toBe(1);

    await act(async () => root.unmount());
    expect(media.listenerCount()).toBe(0);

    // Re-create so afterEach can unmount safely.
    root = createRoot(container);
    await act(async () => root.render(<WorkspaceThemeController preference="system" />));
  });
});

describe("WorkspacePreferencesProvider", () => {
  function Probe() {
    const preferences = useWorkspacePreferences();
    return <span data-testid="probe">{`${preferences.theme}:${preferences.accent}`}</span>;
  }

  it("exposes the server-owned preferences to client boundaries", async () => {
    await act(async () => {
      root.render(
        <WorkspacePreferencesProvider
          value={{
            theme: "dark",
            accent: "blue",
            density: "compact",
            reducedMotion: true,
            launchPage: "today",
            taskLayout: "kanban",
            taskOpenMode: "full",
          }}
        >
          <Probe />
        </WorkspacePreferencesProvider>,
      );
    });

    expect(container.querySelector("[data-testid=probe]")?.textContent).toBe("dark:blue");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("falls back to the documented defaults when rendered outside a provider", async () => {
    await act(async () => {
      root.render(<Probe />);
    });

    expect(container.querySelector("[data-testid=probe]")?.textContent).toBe("system:neutral");
  });

  it("server-renders the provided preferences for hydration", () => {
    const markup = renderToStaticMarkup(
      <WorkspacePreferencesProvider
        value={{
          theme: "light",
          accent: "green",
          density: "comfortable",
          reducedMotion: false,
          launchPage: "tasks",
          taskLayout: "list",
          taskOpenMode: "panel",
        }}
      >
        <Probe />
      </WorkspacePreferencesProvider>,
    );

    assert.match(markup, /light:green/);
  });
});
