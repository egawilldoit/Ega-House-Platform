"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search } from "lucide-react";

import { searchWorkspaceAction } from "@/app/search/actions";
import type { WorkspaceSearchResults } from "@/lib/services/workspace-search-service";
import { WORKSPACE_SEARCH_MIN_QUERY_LENGTH } from "@/lib/workspace-search";
import { useCanonicalUrl } from "@/lib/use-canonical-url";

import {
  buildWorkspaceSections,
  filterNavigationItems,
  flattenPaletteSections,
  nextActiveIndex,
  type CommandPaletteSection,
} from "./command-palette-model";

export const COMMAND_PALETTE_EVENT = "ega:open-command-palette";

const SEARCH_DEBOUNCE_MS = 180;

type PaletteStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; query: string };

type PaletteState = {
  query: string;
  result: WorkspaceSearchResults | null;
  status: PaletteStatus;
};

const IDLE_PALETTE_STATE: PaletteState = { query: "", result: null, status: { kind: "idle" } };

export function CommandPalette() {
  const router = useRouter();
  const canonicalUrl = useCanonicalUrl();
  const [open, setOpen] = useState(false);
  const [{ query, result, status }, setPaletteState] = useState<PaletteState>(IDLE_PALETTE_STATE);
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
      setOpen(true);
    };

    window.addEventListener(COMMAND_PALETTE_EVENT, toggleFromShortcut);
    return () => window.removeEventListener(COMMAND_PALETTE_EVENT, toggleFromShortcut);
  }, []);

  const trimmedQuery = query.trim();
  const shouldSearch = trimmedQuery.length >= WORKSPACE_SEARCH_MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!open || !shouldSearch) {
      return;
    }

    const firedQuery = trimmedQuery;
    const timer = window.setTimeout(() => {
      setPaletteState((current) =>
        current.query.trim() === firedQuery ? { ...current, status: { kind: "loading" } } : current,
      );

      searchWorkspaceAction(firedQuery)
        .then((searchResult) => {
          setPaletteState((current) =>
            current.query.trim() === firedQuery
              ? { query: firedQuery, result: searchResult, status: { kind: "idle" } }
              : current,
          );
        })
        .catch(() => {
          setPaletteState((current) =>
            current.query.trim() === firedQuery
              ? { query: firedQuery, result: null, status: { kind: "error", query: firedQuery } }
              : current,
          );
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [open, shouldSearch, trimmedQuery]);

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
    shouldSearch && result?.query === trimmedQuery ? buildWorkspaceSections(result) : [];
  const navigationItems = filterNavigationItems(trimmedQuery);
  const navigationSection: CommandPaletteSection | null =
    navigationItems.length > 0 ? { id: "go-to", title: "Go to", items: navigationItems } : null;
  const allSections = [...(navigationSection ? [navigationSection] : []), ...workspaceSections];
  const items = flattenPaletteSections(allSections);
  const itemCount = items.length;
  const clampedRequestedIndex =
    requestedActiveIndex >= itemCount ? Math.max(0, itemCount - 1) : requestedActiveIndex;
  const activeIndex = Math.min(clampedRequestedIndex, itemCount - 1);
  const showingResultForCurrentQuery = result?.query === trimmedQuery;
  const hasNoResults = shouldSearch && showingResultForCurrentQuery && itemCount === 0 && status.kind === "idle";

  const goToItem = (item: (typeof items)[number] | undefined) => {
    if (!item) {
      return;
    }

    closePalette();
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

  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 bg-[rgba(20,32,19,0.24)] backdrop-blur-[2px]"
        onClick={closePalette}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search tasks, goals, and projects"
        className="absolute inset-x-4 top-[12vh] mx-auto max-w-xl overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[0_24px_64px_rgba(20,32,19,0.22)]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={itemCount > 0}
            aria-controls={listId}
            aria-activedescendant={items[activeIndex] ? `${listId}-option-${activeIndex}` : undefined}
            aria-label="Search tasks, goals, and projects"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) =>
              setPaletteState((current) => ({ ...current, query: event.target.value }))
            }
            onKeyDown={handleInputKeyDown}
            placeholder="Search tasks, goals, projects…"
            className="w-full bg-transparent text-[0.95rem] text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--muted-foreground)]"
          />
          {status.kind === "loading" ? (
            <span className="shrink-0 text-xs text-[color:var(--muted-foreground)]" role="status">
              Searching…
            </span>
          ) : null}
        </div>

        <div id={listId} role="listbox" aria-label="Search results" className="max-h-[46vh] overflow-y-auto p-2">
          {hasNoResults ? (
            <p className="px-3 py-6 text-sm text-[color:var(--muted-foreground)]">
              No matches for “{trimmedQuery}”.
            </p>
          ) : null}

          {status.kind === "error" && status.query === trimmedQuery ? (
            <p className="px-3 py-6 text-sm text-[color:var(--muted-foreground)]" role="alert">
              Search is unavailable right now. Try again in a moment.
            </p>
          ) : null}

          {allSections.map((section) => {
            const sectionStart = items.findIndex((item) => item.id === section.items[0]?.id);

            return (
              <div key={section.id} className="mb-1 last:mb-0">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
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
                      onClick={() => goToItem(item)}
                      onMouseEnter={() => setRequestedActiveIndex(flatIndex)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                        isActive ? "bg-[color:var(--instrument)]" : ""
                      } text-[color:var(--foreground)]`}
                    >
                      <span className="min-w-0 truncate">{item.label}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                        {item.hint ? <span className="truncate">{item.hint}</span> : null}
                        {isActive ? <CornerDownLeft aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-[var(--border)] px-4 py-2 text-[11px] text-[color:var(--muted-foreground)]">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
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
