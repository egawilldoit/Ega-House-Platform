"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskDrawerMode } from "./use-task-drawer-param";

export type TaskDrawerTask = {
  id: string;
  title: string;
  status: string;
};

type TaskDrawerProps = {
  task: TaskDrawerTask | null;
  mode: TaskDrawerMode;
  onClose: () => void;
  onModeChange: (mode: TaskDrawerMode) => void;
  /**
   * Element to focus when the drawer closes. Defaults to whatever was focused
   * when the drawer mounted (the row link that opened it).
   */
  restoreFocusRef?: RefObject<HTMLElement | null>;
  /** Extra content under the header; property sections arrive in stage 2. */
  children?: React.ReactNode;
};

const MOBILE_QUERY = "(max-width: 760px)";

/**
 * Selected-task detail shell.
 *
 * Desktop is a non-modal right-hand panel (the list stays usable); narrow
 * viewports get a modal full-screen presentation with a scrim, because a
 * non-modal panel that covers the screen would trap the user behind an inert
 * page. Radix owns focus trapping and Escape dismissal; focus restoration and
 * the desktop no-dismiss-on-outside-click rule are explicit here.
 */
export function TaskDrawer({
  task,
  mode,
  onClose,
  onModeChange,
  restoreFocusRef,
  children,
}: TaskDrawerProps) {
  const [isNarrow, setIsNarrow] = useState(false);
  // Captured before Radix moves focus into the dialog.
  const openerRef = useRef<HTMLElement | null>(null);
  const taskId = task?.id ?? null;

  useEffect(() => {
    if (!taskId) return;
    openerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    // Only when a different task opens: later renders must not overwrite the
    // opener with a control inside the drawer.
  }, [taskId]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  const full = mode === "full" || isNarrow;

  return (
    <Dialog.Root
      open={task !== null}
      modal={isNarrow}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        {isNarrow ? (
          <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--ega-overlay)]" />
        ) : null}
        {/* Escape is left to Radix's dismissable layer: an open popover inside
            the drawer consumes it first, and only the drawer layer closes the
            dialog (single onOpenChange -> onClose). */}
        <Dialog.Content
          aria-describedby={undefined}
          onInteractOutside={(event) => {
            // A non-modal panel must not dismiss on background clicks: the list
            // stays usable, and clicking another row should switch selection.
            // modal={isNarrow} still dismisses via the scrim on mobile.
            if (!isNarrow) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            // Radix prevents its default restore when no Dialog.Trigger exists,
            // so the opener (or an explicit target) is focused here.
            const target = restoreFocusRef?.current ?? openerRef.current;
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          className={cn(
            "fixed z-50 flex flex-col border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[var(--ega-shadow-lg)]",
            "focus:outline-none",
            full
              ? "inset-0 border-0"
              : "inset-y-0 right-0 w-[min(560px,100vw)] border-l",
            isNarrow && "inset-0",
          )}
        >
          <header className="flex items-center gap-2 border-b border-[var(--ega-divider)] px-4 py-3">
            <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium text-[color:var(--ega-text)]">
              {task?.title ?? "Task"}
            </Dialog.Title>
            <button
              type="button"
              onClick={() => onModeChange(full && !isNarrow ? "panel" : "full")}
              aria-label={full && !isNarrow ? "Collapse to side panel" : "Expand to full page"}
              className="inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)]"
              hidden={isNarrow}
            >
              {full ? (
                <Minimize2 aria-hidden="true" className="size-3.5" />
              ) : (
                <Maximize2 aria-hidden="true" className="size-3.5" />
              )}
            </button>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close task details"
                className="inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)]"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
