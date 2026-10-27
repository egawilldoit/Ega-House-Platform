"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search, X } from "lucide-react";

import { searchWorkspaceAction } from "@/app/search/actions";
import { COMMAND_PALETTE_EVENT, INBOX_CAPTURE_EVENT, QUICK_TASK_EVENT } from "@/lib/workspace-events";
import type {
  WorkspaceSearchResults,
  WorkspaceSearchScope,
} from "@/lib/services/workspace-search-service";
import { WORKSPACE_SEARCH_SCOPES } from "@/lib/services/workspace-search-service";
import { WORKSPACE_SEARCH_MIN_QUERY_LENGTH } from "@/lib/workspace-search";
import { useCanonicalUrl } from "@/lib/use-canonical-url";

import {
  COMMAND_PALETTE_MODES,
  COMMAND_PALETTE_SCOPE_LABELS,
  buildWorkspaceSections,
  filterNavigationItems,
  filterQuickActionItems,
  flattenPaletteSections,
  highlightMatch,
  nextActiveIndex,
  parseStoredRecents,
  recentEntityFromHref,
  recentsSection,
  recentsStorageKey,
  rememberRecent,
  serializeRecents,
  type CommandPaletteMode,
  type CommandPaletteSection,
  type RecentCommandEntity,
} from "./command-palette-model";

export { COMMAND_PALETTE_EVENT };

const SEARCH_DEBOUNCE_MS = 180;

type PaletteStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; query: string; scope: WorkspaceSearchScope };

type PaletteState = {
  query: string;
  result: WorkspaceSearchResults | null;
  status: PaletteStatus;
};

const IDLE_PALETTE_STATE: PaletteState = { query: "", result: null, status: { kind: "idle" } };

function Highlighted({ label, query }: { label: string; query: string }) {
  return (
    <>
      {highlightMatch(label, query).map((segment, index) =>
        segment.match ? (
          <mark
            key={`${index}-${segment.text}`}
            className="rounded-[2px] bg-[var(--ega-gold-soft)] text-[color:var(--ega-text)]"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={`${index}-${segment.text}`}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function CommandPalette({ ownerId = null }: { ownerId?: string | null }) {
  const router = useRouter();
  const canonicalUrl = useCanonicalUrl();
  const [open, setOpen] = useState(false);
  const [{ query, result, status }, setPaletteState] = useState<PaletteState>(IDLE_PALETTE_STATE);
  const [mode, setMode] = useState<CommandPaletteMode>("recents");
  const [scope, setScope] = useState<WorkspaceSearchScope>("all");
  const [recents, setRecents] = useState<RecentCommandEntity[]>([]);
  const [requestedActiveIndex, setRequestedActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);
  const listId = useId();

  const closePalette = () => setOpen(false);

  useEffect(() => {
    const toggleFromShortcut = () => {
      if (openRef.current) {
        setOpen(false);
        return;
      }

      setPaletteState(IDLE_PALETTE_STATE);
      setRequestedActiveIndex(0);
      setMode("recents");
      setScope("all");
      try {
        const key = recentsStorageKey(ownerId);
        setRecents(parseStoredRecents(window.localStorage.getItem(key), ownerId));
      } catch {
        setRecents([]);
      }
      setOpen(true);
    };

    window.addEventListener(COMMAND_PALETTE_EVENT, toggleFromShortcut);
    return () => window.removeEventListener(COMMAND_PALETTE_EVENT, toggleFromShortcut);
  }, [ownerId]);

  const trimmedQuery = query.trim();
  const shouldSearch = mode === "search" && trimmedQuery.length >= WORKSPACE_SEARCH_MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!open || !shouldSearch) {
      return;
    }

    const firedQuery = trimmedQuery;
    const firedScope = scope;
    const timer = window.setTimeout(() => {
      setPaletteState((current) =>
        current.query.trim() === firedQuery
          ? { ...current, status: { kind: "loading" } }
          : current,
      );

      searchWorkspaceAction(firedQuery, firedScope)
        .then((searchResult) => {
          // Query+scope guard discards stale or out-of-order responses.
          setPaletteState((current) =>
            current.query.trim() === firedQuery
              ? {
                  query: firedQuery,
                  result: { ...searchResult, scope: firedScope },
                  status: { kind: "idle" },
                }
              : current,
          );
        })
        .catch(() => {
          setPaletteState((current) =>
            current.query.trim() === firedQuery
              ? {
                  query: firedQuery,
                  result: null,
                  status: { kind: "error", query: firedQuery, scope: firedScope },
                }
              : current,
          );
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [open, shouldSearch, trimmedQuery, scope]);

  useEffect(() => {
    if (!open) {
      openRef.current = false;
      return;
    }

    openRef.current = true;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    queueMicrotask(() => inputRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePalette();
        return;
      }

      // Explicit mode switching keeps normal Tab traversal intact.
      if (event.altKey && ["1", "2", "3"].includes(event.key)) {
        event.preventDefault();
        const nextMode = COMMAND_PALETTE_MODES[Number(event.key) - 1];
        if (nextMode) setMode(nextMode.id);
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );

      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === first || activeElement === inputRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const workspaceSections: CommandPaletteSection[] =
    shouldSearch && result?.query === trimmedQuery && result.scope === scope
      ? buildWorkspaceSections(result)
      : [];
  const recentItems = recentsSection(recents);
  const navigationItems = filterNavigationItems(mode === "commands" ? trimmedQuery : "");
  const navigationSection: CommandPaletteSection | null =
    mode === "commands" && navigationItems.length > 0
      ? { id: "go-to", title: "Go to", items: navigationItems }
      : null;
  const quickActionItems = filterQuickActionItems(mode === "commands" ? trimmedQuery : "");
  const quickActionSection: CommandPaletteSection | null =
    mode === "commands" && quickActionItems.length > 0
      ? { id: "quick-actions", title: "Quick actions", items: quickActionItems }
      : null;
  const allSections = [
    ...(navigationSection ? [navigationSection] : []),
    ...(mode === "recents" ? (recentItems ? [recentItems] : []) : []),
    ...workspaceSections,
    ...(quickActionSection ? [quickActionSection] : []),
  ];
  const items = flattenPaletteSections(allSections);
  const itemCount = items.length;
  const clampedRequestedIndex =
    requestedActiveIndex >= itemCount ? Math.max(0, itemCount - 1) : requestedActiveIndex;
  const activeIndex = Math.min(clampedRequestedIndex, itemCount - 1);
  const showingResultForCurrentQuery = result?.query === trimmedQuery && result.scope === scope;
  const hasNoResults =
    shouldSearch && showingResultForCurrentQuery && itemCount === 0 && status.kind === "idle";
  const showEmptyRecents = mode === "recents" && recents.length === 0;

  const recordRecent = (item: (typeof items)[number] | undefined) => {
    if (!item) return;
    const entity = recentEntityFromHref(item.href, item.label);
    if (!entity) return;
    const next = rememberRecent(recents, entity);
    setRecents(next);
    try {
      window.localStorage.setItem(recentsStorageKey(ownerId), serializeRecents(next, ownerId));
    } catch {
      // Storage can be unavailable (private mode); recents stay session-only.
    }
  };

  const goToItem = (item: (typeof items)[number] | undefined) => {
    if (!item) {
      return;
    }

    recordRecent(item);
    closePalette();
    if (item.action === "capture") {
      window.dispatchEvent(new CustomEvent(INBOX_CAPTURE_EVENT));
      return;
    }
    if (item.action === "quick-task") {
      window.dispatchEvent(new CustomEvent(QUICK_TASK_EVENT));
      return;
    }
    router.push(canonicalUrl.resolve(item.href));
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
      return;
    }

    if (event.key === "ArrowDown") {
      if (itemCount === 0) {
        return;
      }

      event.preventDefault();
      setRequestedActiveIndex((current) =>
        nextActiveIndex(Math.min(current, itemCount - 1), itemCount, 1),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      if (itemCount === 0) {
        return;
      }

      event.preventDefault();
      setRequestedActiveIndex((current) =>
        nextActiveIndex(Math.min(current, itemCount - 1), itemCount, -1),
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      goToItem(items[activeIndex]);
    }
  };

  const modeHint = COMMAND_PALETTE_MODES.find((entry) => entry.id === mode)?.hint;

  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 bg-[var(--ega-overlay-soft)] backdrop-blur-[2px]"
        onClick={closePalette}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search, commands and recents"
        className="absolute inset-x-4 top-[12vh] mx-auto max-w-xl overflow-hidden rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[var(--ega-shadow-lg)]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--ega-border)] px-4 py-3">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--ega-text-secondary)]" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={itemCount > 0}
            aria-controls={listId}
            aria-activedescendant={items[activeIndex] ? `${listId}-option-${activeIndex}` : undefined}
            aria-label="Search tasks, projects, goals and ideas"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setPaletteState((current) => ({ ...current, query: value }));
              if (value.trim()) setMode("search");
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={
              mode === "commands"
                ? "Filter commands…"
                : mode === "recents"
                  ? "Type to search, or open a recent item"
                  : "Search tasks, projects, goals, ideas…"
            }
            className="w-full bg-transparent text-[0.95rem] text-[var(--ega-text)] outline-none placeholder:text-[var(--ega-text-tertiary)]"
          />
          {status.kind === "loading" ? (
            <span className="shrink-0 text-xs text-[var(--ega-text-secondary)]" role="status">
              Searching…
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Close command palette"
            title="Close"
            onClick={closePalette}
            className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ega-text-tertiary)] transition-[background-color,color] hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)]"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ega-border)] px-3 py-2">
          <div role="tablist" aria-label="Palette mode" className="flex items-center gap-1">
            {COMMAND_PALETTE_MODES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={mode === entry.id}
                title={`${entry.label} (${entry.hint})`}
                onClick={() => setMode(entry.id)}
                className={`rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-medium uppercase tracking-[0.08em] ${
                  mode === entry.id
                    ? "bg-[var(--ega-gold-soft)] text-[color:var(--ega-text)]"
                    : "text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)]"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {mode === "search" ? (
            <div role="group" aria-label="Search scope" className="flex flex-wrap items-center gap-1">
              {WORKSPACE_SEARCH_SCOPES.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  aria-pressed={scope === entry}
                  onClick={() => setScope(entry)}
                  className={`rounded-[var(--radius-sm)] border px-2 py-0.5 text-[11px] ${
                    scope === entry
                      ? "border-[var(--ega-border-strong)] bg-[var(--ega-surface-hover)] text-[color:var(--ega-text)]"
                      : "border-transparent text-[color:var(--ega-text-secondary)] hover:border-[var(--ega-border)]"
                  }`}
                >
                  {COMMAND_PALETTE_SCOPE_LABELS[entry]}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-[11px] text-[var(--ega-text-tertiary)]">{modeHint}</span>
          )}
        </div>

        <div id={listId} role="listbox" aria-label="Search results" className="max-h-[46vh] overflow-y-auto p-2">
          {hasNoResults ? (
            <p className="px-3 py-6 text-sm text-[var(--ega-text-secondary)]">
              No matches for “{trimmedQuery}”.
            </p>
          ) : null}

          {showEmptyRecents ? (
            <p className="px-3 py-6 text-sm text-[var(--ega-text-secondary)]">
              Nothing opened yet. Search or run a command and it will appear here.
            </p>
          ) : null}

          {status.kind === "error" && status.query === trimmedQuery && status.scope === scope ? (
            <p className="px-3 py-6 text-sm text-[var(--ega-text-secondary)]" role="alert">
              Search is unavailable right now. Try again in a moment.
            </p>
          ) : null}

          {allSections.map((section) => {
            const sectionStart = items.findIndex((item) => item.id === section.items[0]?.id);

            return (
              <div key={section.id} className="mb-1 last:mb-0">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ega-text-tertiary)]">
                  {section.title}
                </p>
                {section.items.map((item, indexInSection) => {
                  const flatIndex = sectionStart + indexInSection;
                  const isActive = flatIndex === activeIndex;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      id={`${listId}-option-${flatIndex}`}
                      role="option"
                      aria-selected={isActive}
                      aria-label={item.label}
                      aria-describedby={item.hint ? `${listId}-option-${flatIndex}-hint` : undefined}
                      onClick={() => goToItem(item)}
                      onMouseEnter={() => setRequestedActiveIndex(flatIndex)}
                      className={`flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm ${
                        isActive ? "bg-[var(--ega-gold-soft)] text-[var(--ega-text)]" : "text-[var(--ega-text)]"
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        <Highlighted label={item.label} query={trimmedQuery} />
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--ega-text-secondary)]">
                        {item.hint ? (
                          <span id={`${listId}-option-${flatIndex}-hint`} className="truncate">
                            {item.hint}
                          </span>
                        ) : null}
                        {isActive ? <CornerDownLeft aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-[var(--ega-border)] px-4 py-2 text-[11px] text-[var(--ega-text-tertiary)]">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>Alt</kbd>+<kbd>1–3</kbd> mode
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
