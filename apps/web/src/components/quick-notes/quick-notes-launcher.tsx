"use client";

import { useEffect, useRef } from "react";
import { StickyNote, X } from "lucide-react";

import { useActiveTimer } from "@/components/timer/floating-timer/active-timer-provider";
import { QuickNotesEditor } from "./quick-notes-editor";

/**
 * Top-bar entry point for Quick Notes. Mounted once via the workspace shell's
 * top-bar slot so it is reachable from every authenticated route.
 *
 * The panel is a separate component mounted outside the shell: the top bar is
 * a stacking context (sticky + z-index), so a fixed panel rendered inside it
 * would be painted behind the sidebar and appear clipped.
 */
export function QuickNotesLauncher() {
  const { quickNotes } = useActiveTimer();

  if (quickNotes.panelOpen) {
    return null;
  }

  return (
    <button
      type="button"
      className="topbar-icon-button ega-quick-notes-launcher"
      onClick={quickNotes.openPanel}
      aria-label="Open Quick notes"
      title="Quick notes"
      data-testid="quick-notes-launcher"
    >
      <StickyNote aria-hidden="true" />
    </button>
  );
}

/** In-app editor surface; the fallback when Document PiP is unavailable. */
export function QuickNotesPanel() {
  const { quickNotes } = useActiveTimer();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!quickNotes.panelOpen) {
      return;
    }
    panelRef.current
      ?.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Quick notes scratchpad"]',
      )
      ?.focus();
  }, [quickNotes.panelOpen]);

  if (!quickNotes.panelOpen) {
    return null;
  }

  return (
    <section
      ref={panelRef}
      className="ega-quick-notes-panel"
      aria-label="Quick notes"
      data-testid="quick-notes-panel"
    >
      <div className="ega-quick-notes-panel__header">
        <h2 className="ega-quick-notes-panel__title">Quick notes</h2>
        <button
          type="button"
          className="ega-quick-notes-panel__close"
          onClick={quickNotes.closePanel}
          aria-label="Close Quick notes panel"
        >
          <X aria-hidden="true" />
        </button>
      </div>

      <QuickNotesEditor
        variant="panel"
        text={quickNotes.text}
        status={quickNotes.status}
        error={quickNotes.error}
        confirmNewNote={quickNotes.confirmNewNote}
        popoutSupported={quickNotes.popoutSupported}
        popoutOpen={quickNotes.popoutOpen}
        onChange={quickNotes.setText}
        onSave={quickNotes.save}
        onNewNote={quickNotes.requestNewNote}
        onConfirmNewNote={quickNotes.confirmNewNoteAction}
        onCancelNewNote={quickNotes.cancelNewNote}
        onPopOut={quickNotes.popOut}
        onClose={quickNotes.closePanel}
        closeLabel="Close Quick notes panel"
      />

      {quickNotes.popoutError ? (
        <div className="ega-quick-notes__error" role="alert">
          <span>{quickNotes.popoutError}</span>
          <button
            type="button"
            className="ega-quick-notes__dismiss"
            onClick={quickNotes.dismissPopoutError}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </section>
  );
}
