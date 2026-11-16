"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { useActiveTimer } from "@/components/timer/floating-timer/active-timer-provider";
import { QuickNotesEditor } from "./quick-notes-editor";

/**
 * Persistent global entry point for Quick Notes. Mounted once inside the
 * workspace shell so it is reachable from every authenticated route, with or
 * without a running timer. The in-app panel is the supported fallback when
 * Document Picture-in-Picture is missing or denied.
 */
export function QuickNotesLauncher() {
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

  return (
    <>
      {!quickNotes.panelOpen ? (
        <button
          type="button"
          className="ega-quick-notes-launcher"
          onClick={quickNotes.openPanel}
          aria-label="Open Quick notes"
          data-testid="quick-notes-launcher"
        >
          Quick notes
        </button>
      ) : null}

      {quickNotes.panelOpen ? (
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
      ) : null}
    </>
  );
}
