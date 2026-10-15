import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExportCsvButton } from "./export-csv-button";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  root?.unmount();
  container.remove();
  vi.restoreAllMocks();
});

describe("ExportCsvButton", () => {
  it("shows preparing state and downloads a file on success", async () => {
    const blob = new Blob(["a,b"], { type: "text/csv" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ "content-disposition": 'attachment; filename="timer-sessions.csv"' }),
      json: async () => ({}),
      blob: async () => blob,
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
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    root = createRoot(container);
    act(() => {
      root.render(<ExportCsvButton href="/timer/export">Export CSV</ExportCsvButton>);
    });

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toBe("Export CSV");

    await act(async () => {
      button.click();
    });

    expect(fetchMock).toHaveBeenCalledWith("/timer/export", { credentials: "same-origin" });
    expect(clickSpy).toHaveBeenCalled();
  });

  it("shows an error status when the response is not ok", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      headers: new Headers(),
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
  });
});