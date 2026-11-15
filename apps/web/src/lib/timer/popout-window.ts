/**
 * Document Picture-in-Picture helpers for the global focus timer.
 *
 * The API is Chromium-desktop only, requires a user gesture and a secure
 * context, and the resulting window is always-on-top but closes with its
 * opener tab. Nothing here launches automatically: callers must invoke
 * `requestTimerPopoutWindow` from a click handler.
 */

export type DocumentPictureInPictureRequestOptions = {
  width?: number;
  height?: number;
};

export type DocumentPictureInPictureApi = {
  requestWindow: (
    options?: DocumentPictureInPictureRequestOptions,
  ) => Promise<Window>;
};

export const TIMER_POPOUT_SIZE = { width: 372, height: 264 } as const;

/** Feature detection that never throws on partial/foreign implementations. */
export function getDocumentPictureInPicture(
  target: unknown = typeof window === "undefined" ? undefined : window,
): DocumentPictureInPictureApi | null {
  if (!target || typeof target !== "object") {
    return null;
  }

  const candidate = (target as { documentPictureInPicture?: unknown })
    .documentPictureInPicture;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const requestWindow = (candidate as { requestWindow?: unknown }).requestWindow;
  if (typeof requestWindow !== "function") {
    return null;
  }

  return candidate as DocumentPictureInPictureApi;
}

/**
 * True only when the browser exposes a usable API and is not explicitly
 * reporting an insecure context. The request can still be rejected (for
 * example inside an iframe without permission); callers handle that as a
 * recoverable error and keep the in-app chip.
 */
export function supportsDocumentPictureInPicture(
  target: unknown = typeof window === "undefined" ? undefined : window,
): boolean {
  if (!getDocumentPictureInPicture(target)) {
    return false;
  }

  const secureContext = (target as { isSecureContext?: boolean })
    .isSecureContext;
  return secureContext !== false;
}

export async function requestTimerPopoutWindow(
  target: unknown = typeof window === "undefined" ? undefined : window,
): Promise<Window> {
  const api = getDocumentPictureInPicture(target);
  if (!api) {
    throw new Error("Document Picture-in-Picture is not available.");
  }

  return api.requestWindow(TIMER_POPOUT_SIZE);
}

export const TIMER_POPOUT_ROOT_ID = "ega-timer-popout-root";
export const TIMER_POPOUT_STYLE_ID = "ega-timer-popout-base-styles";

const THEME_ATTRIBUTES = [
  "data-theme",
  "data-theme-preference",
  "data-accent",
  "data-density",
  "data-reduce-motion",
] as const;

/**
 * Self-contained fallback styles.
 *
 * Origin styles are copied too, so fonts and tokens usually match exactly. If
 * a browser or deployment blocks stylesheet cloning, the window still renders
 * a readable, correctly sized timer.
 */
export const TIMER_POPOUT_BASE_STYLES = `
:root { color-scheme: light dark; }
html, body {
  margin: 0;
  min-height: 100%;
  background: var(--ega-bg, #f2f2f2);
  color: var(--ega-text, #171717);
  font-family: var(--font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}
body { display: block; }
.ega-timer-popout {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100vh;
  padding: 16px;
  background: var(--ega-surface, #ffffff);
  border-top: 2px solid var(--signal-live, #15803d);
}
.ega-timer-popout__status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--ega-text-secondary, #5c5c5c);
  text-transform: uppercase;
}
.ega-timer-popout__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--signal-live, #15803d);
}
.ega-timer-popout__dot[data-stopped="true"] { background: var(--ega-text-tertiary, #6a6a6a); }
.ega-timer-popout__title {
  margin: 0;
  font-size: 16px;
  line-height: 1.3;
  font-weight: 650;
  color: var(--ega-text, #171717);
  overflow-wrap: anywhere;
}
.ega-timer-popout__project {
  margin: 0;
  font-size: 13px;
  color: var(--ega-text-secondary, #5c5c5c);
  overflow-wrap: anywhere;
}
.ega-timer-popout__clock {
  margin: 2px 0 0;
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 34px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  font-weight: 650;
  color: var(--ega-text, #171717);
}
.ega-timer-popout__note {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ega-text-secondary, #5c5c5c);
}
.ega-timer-popout__error {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--status-overdue, #b91c1c);
}
.ega-timer-popout__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--ega-divider, #eeeeee);
}
.ega-timer-popout__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--ega-border-strong, #d6d6d6);
  border-radius: 6px;
  background: var(--ega-surface, #ffffff);
  color: var(--ega-text, #171717);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}
.ega-timer-popout__button:hover { background: var(--ega-surface-hover, #f5f5f5); }
.ega-timer-popout__button:focus-visible {
  outline: 2px solid var(--ega-text, #171717);
  outline-offset: 2px;
}
.ega-timer-popout__button--danger {
  border-color: var(--status-overdue-border, #fecaca);
  background: var(--status-overdue-bg, #fef2f2);
  color: var(--status-overdue, #b91c1c);
}
.ega-timer-popout__button:disabled { cursor: not-allowed; opacity: 0.55; }
`;

/** Copy origin documents styles and theme attributes, then add the fallback. */
export function prepareTimerPopoutDocument(
  targetDocument: Document,
  sourceDocument: Document,
): HTMLElement {
  targetDocument.title = "Focus timer | EGA House";
  targetDocument.documentElement.lang = sourceDocument.documentElement.lang || "en";

  for (const attribute of THEME_ATTRIBUTES) {
    const value = sourceDocument.documentElement.getAttribute(attribute);
    if (value !== null) {
      targetDocument.documentElement.setAttribute(attribute, value);
    }
  }

  targetDocument.body.replaceChildren();
  targetDocument.body.className = "ega-timer-popout-body";

  const styles = sourceDocument.querySelectorAll(
    'link[rel="stylesheet"], style',
  );
  for (const style of Array.from(styles)) {
    const clone = style.cloneNode(true) as Element;
    targetDocument.head.append(clone);
  }

  try {
    const adopted = sourceDocument.adoptedStyleSheets;
    if (Array.isArray(adopted) && adopted.length > 0) {
      targetDocument.adoptedStyleSheets = [...adopted];
    }
  } catch {
    // Constructable stylesheets are an enhancement; clones already cover the
    // normal Next.js stylesheet path.
  }

  const fallback = targetDocument.createElement("style");
  fallback.id = TIMER_POPOUT_STYLE_ID;
  fallback.textContent = TIMER_POPOUT_BASE_STYLES;
  targetDocument.head.append(fallback);

  const root = targetDocument.createElement("div");
  root.id = TIMER_POPOUT_ROOT_ID;
  targetDocument.body.append(root);
  return root;
}

/**
 * Observe native close. `pagehide` is the documented Document PiP close signal;
 * `beforeunload` is a defensive fallback for implementations that only emit it.
 * The callback runs at most once.
 */
export function attachTimerPopoutLifecycle(
  popoutWindow: Window,
  onClose: () => void,
): () => void {
  let closed = false;

  const handleClose = () => {
    if (closed) {
      return;
    }
    closed = true;
    onClose();
  };

  popoutWindow.addEventListener("pagehide", handleClose);
  popoutWindow.addEventListener("beforeunload", handleClose);

  return () => {
    popoutWindow.removeEventListener("pagehide", handleClose);
    popoutWindow.removeEventListener("beforeunload", handleClose);
  };
}
