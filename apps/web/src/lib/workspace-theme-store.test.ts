import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WORKSPACE_THEME_STORAGE_KEY } from "./theme-preference";

type MatchMediaFixture = {
  setDark: (value: boolean) => void;
  listenerCount: () => number;
};

let unsubscribe: (() => void) | null = null;

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

beforeEach(() => {
  localStorage.clear();
  resetDocument();
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
  vi.restoreAllMocks();
  localStorage.clear();
  resetDocument();
});

describe("workspace theme store", () => {
  it("defaults to System and follows a dark OS on first initialisation", async () => {
    vi.resetModules();
    const media = installMatchMedia(true);
    localStorage.clear();
    const store = await import("./workspace-theme-store");

    expect(store.getWorkspaceThemeSnapshot()).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("system");
    expect(media.listenerCount()).toBe(0);
  });

  it("explicit light and dark override the OS", async () => {
    vi.resetModules();
    installMatchMedia(false);
    const store = await import("./workspace-theme-store");

    store.setWorkspaceThemePreference("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY)).toBe("dark");

    store.setWorkspaceThemePreference("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY)).toBe("light");
  });

  it("System follows live OS changes without a refresh", async () => {
    vi.resetModules();
    const media = installMatchMedia(false);
    const store = await import("./workspace-theme-store");
    const seen: string[] = [];
    unsubscribe = store.subscribeWorkspaceTheme(() => {
      seen.push(store.getWorkspaceThemeSnapshot());
    });

    store.setWorkspaceThemePreference("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(media.listenerCount()).toBe(1);

    media.setDark(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("system");

    media.setDark(false);
    expect(document.documentElement.dataset.theme).toBe("light");

    expect(seen).toContain("system");
    expect(media.listenerCount()).toBe(1);
  });

  it("an explicit choice ignores OS changes", async () => {
    vi.resetModules();
    const media = installMatchMedia(false);
    const store = await import("./workspace-theme-store");
    store.setWorkspaceThemePreference("light");

    media.setDark(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("reads a stored preference on reload", async () => {
    vi.resetModules();
    installMatchMedia(false);
    localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, "dark");
    const store = await import("./workspace-theme-store");

    expect(store.getWorkspaceThemeSnapshot()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("treats invalid stored values as System", async () => {
    vi.resetModules();
    installMatchMedia(true);
    localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, "sepia");
    const store = await import("./workspace-theme-store");

    expect(store.getWorkspaceThemeSnapshot()).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("keeps working when storage is unavailable", async () => {
    vi.resetModules();
    installMatchMedia(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const store = await import("./workspace-theme-store");

    expect(store.getWorkspaceThemeSnapshot()).toBe("system");
    expect(() => store.setWorkspaceThemePreference("dark")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("dark");
  });

  it("synchronises preference changes from another tab", async () => {
    vi.resetModules();
    installMatchMedia(false);
    const store = await import("./workspace-theme-store");
    unsubscribe = store.subscribeWorkspaceTheme(() => undefined);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: WORKSPACE_THEME_STORAGE_KEY,
        newValue: "dark",
      }),
    );

    expect(store.getWorkspaceThemeSnapshot()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores preference events from unrelated storage areas", async () => {
    vi.resetModules();
    installMatchMedia(false);
    const store = await import("./workspace-theme-store");
    unsubscribe = store.subscribeWorkspaceTheme(() => undefined);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: WORKSPACE_THEME_STORAGE_KEY,
        newValue: "dark",
        storageArea: window.sessionStorage,
      }),
    );

    expect(store.getWorkspaceThemeSnapshot()).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("accepts preference events from the workspace localStorage area", async () => {
    vi.resetModules();
    installMatchMedia(false);
    const store = await import("./workspace-theme-store");
    unsubscribe = store.subscribeWorkspaceTheme(() => undefined);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: WORKSPACE_THEME_STORAGE_KEY,
        newValue: "dark",
        storageArea: window.localStorage,
      }),
    );

    expect(store.getWorkspaceThemeSnapshot()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("has a deterministic server snapshot for hydration", async () => {
    vi.resetModules();
    installMatchMedia(false);
    localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, "dark");
    const store = await import("./workspace-theme-store");

    expect(store.getWorkspaceThemeServerSnapshot()).toBe("system");
    expect(store.getWorkspaceThemeSnapshot()).toBe("dark");
  });

  it("hydrates a stored light preference under a dark OS without changing the server snapshot", async () => {
    vi.resetModules();
    installMatchMedia(true);
    localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, "light");
    const store = await import("./workspace-theme-store");

    expect(store.getWorkspaceThemeServerSnapshot()).toBe("system");
    expect(store.getWorkspaceThemeSnapshot()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themePreference).toBe("light");
  });
});
