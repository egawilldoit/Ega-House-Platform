import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExportCsvButton } from "./export-csv-button";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  root?.unmount();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

describe("ExportCsvButton", () => {
  it("shows preparing state, downloads with header filename, then success and re-enables", async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(() => fetchPromise);
    vi.stubGlobal("fetch", fetchMock);

    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === "a") {
        (element as HTMLAnchorElement).click = clickSpy;
      }
      return element;
    });
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    root = createRoot(container);
    act(() => {
      root.render(<ExportCsvButton href="/timer/export" defaultFilename="fallback.csv">Export CSV</ExportCsvButton>);
    });

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toBe("Export CSV");
    expect(button.disabled).toBe(false);

    act(() => {
      button.click();
    });

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Preparing export…");

    await act(async () => {
      resolveFetch({
        ok: true,
        redirected: false,
        headers: new Headers({ "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="timer-sessions.csv"' }),
        json: async () => ({}),
        blob: async () => new Blob(["a,b"], { type: "text/csv" }),
      });
      await fetchPromise;
    });

    expect(fetchMock).toHaveBeenCalledWith("/timer/export", { credentials: "same-origin" });
    expect(clickSpy).toHaveBeenCalled();
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(container.textContent).toContain("Downloaded timer-sessions.csv");
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Export CSV");

    // Revocation is deferred until after the click has started.
  });

  it("shows actionable failure for an ok 200 non-CSV redirect response and never downloads", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      redirected: true,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      json: async () => {
        throw new Error("not json");
      },
      blob: async () => new Blob(["<html></html>"], { type: "text/html" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === "a") {
        (element as HTMLAnchorElement).click = clickSpy;
      }
      return element;
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");

    root = createRoot(container);
    act(() => {
      root.render(<ExportCsvButton href="/timer/export">Export CSV</ExportCsvButton>);
    });

    const button = container.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Your session expired. Please sign in and try again.");
    expect(button.disabled).toBe(false);
  });

  it("shows an actionable API error and keeps the button retryable", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      redirected: false,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ error: "Unable to export timer sessions right now." }),
      blob: async () => new Blob(),
    }));
    vi.stubGlobal("fetch", fetchMock);

    root = createRoot(container);
    act(() => {
      root.render(<ExportCsvButton href="/timer/export">Export CSV</ExportCsvButton>);
    });

    const button = container.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(container.textContent).toContain("Unable to export timer sessions right now.");
    expect(button.disabled).toBe(false);

    await act(async () => {
      button.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
