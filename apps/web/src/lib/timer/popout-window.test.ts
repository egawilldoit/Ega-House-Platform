// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TIMER_POPOUT_ROOT_ID,
  TIMER_POPOUT_SIZE,
  TIMER_POPOUT_STYLE_ID,
  attachTimerPopoutLifecycle,
  getDocumentPictureInPicture,
  prepareTimerPopoutDocument,
  requestTimerPopoutWindow,
  shouldDeferHiddenTimerRefresh,
  supportsDocumentPictureInPicture,
} from "./popout-window";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Document Picture-in-Picture feature detection", () => {
  it("returns null when the API is missing or malformed", () => {
    expect(getDocumentPictureInPicture(undefined)).toBeNull();
    expect(getDocumentPictureInPicture({})).toBeNull();
    expect(getDocumentPictureInPicture({ documentPictureInPicture: {} })).toBeNull();
    expect(
      getDocumentPictureInPicture({
        documentPictureInPicture: { requestWindow: "no" },
      }),
    ).toBeNull();
  });

  it("detects a usable API and respects an explicitly insecure context", () => {
    const api = { requestWindow: vi.fn(async () => ({}) as Window) };
    const target = { documentPictureInPicture: api, isSecureContext: true };

    expect(getDocumentPictureInPicture(target)).toBe(api);
    expect(supportsDocumentPictureInPicture(target)).toBe(true);
    expect(
      supportsDocumentPictureInPicture({
        documentPictureInPicture: api,
        isSecureContext: false,
      }),
    ).toBe(false);
  });

  it("requests the configured compact window size", async () => {
    const popout = {} as Window;
    const requestWindow = vi.fn(async () => popout);
    const api = { requestWindow };

    await expect(
      requestTimerPopoutWindow({ documentPictureInPicture: api }),
    ).resolves.toBe(popout);
    expect(requestWindow).toHaveBeenCalledWith(TIMER_POPOUT_SIZE);
  });

  it("fails clearly when unsupported instead of pretending to open a window", async () => {
    await expect(requestTimerPopoutWindow({})).rejects.toThrow(
      "Document Picture-in-Picture is not available.",
    );
  });

  it("defer hidden-opener refreshes only when no popout is owned", () => {
    expect(shouldDeferHiddenTimerRefresh(true, false)).toBe(true);
    expect(shouldDeferHiddenTimerRefresh(true, true)).toBe(false);
    expect(shouldDeferHiddenTimerRefresh(false, false)).toBe(false);
    expect(shouldDeferHiddenTimerRefresh(false, true)).toBe(false);
  });
});

describe("prepareTimerPopoutDocument", () => {
  it("copies styles/theme, installs the fallback style and creates the root", () => {
    const source = document.implementation.createHTMLDocument("source");
    source.documentElement.setAttribute("data-theme", "dark");
    source.documentElement.setAttribute("data-accent", "slate");
    source.documentElement.lang = "en-GB";

    const link = source.createElement("link");
    link.rel = "stylesheet";
    link.href = "/assets/app.css";
    source.head.append(link);

    const inline = source.createElement("style");
    inline.textContent = ".from-origin{color:red}";
    source.head.append(inline);

    const target = document.implementation.createHTMLDocument("target");
    const root = prepareTimerPopoutDocument(target, source);

    expect(root.id).toBe(TIMER_POPOUT_ROOT_ID);
    expect(target.body.contains(root)).toBe(true);
    expect(target.title).toBe("Focus timer | EGA House");
    expect(target.documentElement.lang).toBe("en-GB");
    expect(target.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(target.documentElement.getAttribute("data-accent")).toBe("slate");
    expect(target.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1);
    expect(
      target.head.querySelector("style")?.textContent,
    ).toContain(".from-origin");
    expect(target.getElementById(TIMER_POPOUT_STYLE_ID)).not.toBeNull();
  });

  it("is idempotent when a document is prepared again", () => {
    const source = document.implementation.createHTMLDocument("source");
    const target = document.implementation.createHTMLDocument("target");

    const first = prepareTimerPopoutDocument(target, source);
    const second = prepareTimerPopoutDocument(target, source);

    expect(first).not.toBe(second);
    expect(target.body.children).toHaveLength(1);
    expect(target.body.firstElementChild).toBe(second);
  });
});

describe("attachTimerPopoutLifecycle", () => {
  it("cleans up once on native close and can be detached", () => {
    const popoutWindow = new EventTarget() as Window;
    const onClose = vi.fn();

    const detach = attachTimerPopoutLifecycle(popoutWindow, onClose);
    popoutWindow.dispatchEvent(new Event("pagehide"));
    popoutWindow.dispatchEvent(new Event("beforeunload"));
    expect(onClose).toHaveBeenCalledTimes(1);

    detach();
    popoutWindow.dispatchEvent(new Event("pagehide"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("removes both listeners when detached before close", () => {
    const popoutWindow = new EventTarget() as Window;
    const onClose = vi.fn();

    attachTimerPopoutLifecycle(popoutWindow, onClose)();
    popoutWindow.dispatchEvent(new Event("pagehide"));
    popoutWindow.dispatchEvent(new Event("beforeunload"));

    expect(onClose).not.toHaveBeenCalled();
  });
});
