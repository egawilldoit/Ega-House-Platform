"use client";

import type { QuickNotesSaveStatus } from "./use-quick-notes-controller";

export type QuickNotesEditorProps = {
  text: string;
  status: QuickNotesSaveStatus;
  error: string | null;
  confirmNewNote: boolean;
  popoutSupported: boolean;
  popoutOpen: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
  onNewNote: () => void;
  onConfirmNewNote: () => void;
  onCancelNewNote: () => void;
  onPopOut: () => void;
  onClose: () => void;
  closeLabel: string;
  variant: "panel" | "popout";
};

const STATUS_COPY: Record<QuickNotesSaveStatus, string> = {
  "saved-locally": "Saved locally",
  unsaved: "Unsaved changes",
  saving: "Saving to Backlog…",
  "saved-to-backlog": "Saved to Backlog",
  error: "Not saved",
};

/**
 * Plain-text scratchpad shared by the in-app panel and the single floating
 * window. It is intentionally prop-driven so the same editor works in the
 * opener tab's React tree and in the popout document's separate root.
 */
export function QuickNotesEditor({
  text,
  status,
  error,
  confirmNewNote,
  popoutSupported,
  popoutOpen,
  onChange,
  onSave,
  onNewNote,
  onConfirmNewNote,
  onCancelNewNote,
  onPopOut,
  onClose,
  closeLabel,
  variant,
}: QuickNotesEditorProps) {
  const textareaId = `quick-notes-textarea-${variant}`;

  return (
    <div className="ega-quick-notes__editor">
      <label className="ega-quick-notes__label" htmlFor={textareaId}>
        Quick note
      </label>
      <textarea
        id={textareaId}
        className="ega-quick-notes__textarea"
        aria-label="Quick notes scratchpad"
        placeholder="Jot something down…"
        value={text}
        onChange={(event) => onChange(event.target.value)}
        autoFocus={variant === "popout"}
        spellCheck
      />

      <p
        className="ega-quick-notes__status"
        data-status={status}
        role="status"
        aria-live="polite"
      >
        {STATUS_COPY[status]}
      </p>

      {error ? (
        <p className="ega-quick-notes__error" role="alert">
          {error}
        </p>
      ) : null}

      {confirmNewNote ? (
        <div className="ega-quick-notes__confirm" role="group" aria-label="Discard unsaved draft">
          <p>Discard this unsaved note?</p>
          <button type="button" className="ega-quick-notes__button" onClick={onConfirmNewNote}>
            Discard draft
          </button>
          <button type="button" className="ega-quick-notes__button" onClick={onCancelNewNote}>
            Keep editing
          </button>
        </div>
      ) : null}

      <div className="ega-quick-notes__actions">
        <button
          type="button"
          className="ega-quick-notes__button ega-quick-notes__button--primary"
          onClick={onSave}
          disabled={status === "saving" || confirmNewNote || !text.trim()}
          aria-label="Save note to Backlog"
        >
          {status === "saving" ? "Saving…" : "Save to Backlog"}
        </button>

        <button
          type="button"
          className="ega-quick-notes__button"
          onClick={onNewNote}
          aria-label="New note or clear draft"
        >
          New note
        </button>

        {popoutSupported ? (
          <button
            type="button"
            className="ega-quick-notes__button"
            onClick={onPopOut}
            aria-label={
              popoutOpen
                ? "Focus always-on-top Quick Notes window"
                : "Pop out Quick Notes to an always-on-top window"
            }
          >
            {popoutOpen ? "Focus window" : "Pop out"}
          </button>
        ) : null}

        <button
          type="button"
          className="ega-quick-notes__button"
          onClick={onClose}
          aria-label={closeLabel}
        >
          {variant === "popout" ? "Close window" : "Close"}
        </button>
      </div>

      {!popoutSupported ? (
        <p className="ega-quick-notes__fallback" role="note">
          Always-on-top is unavailable in this browser. Quick Notes still works
          here in EGA House.
        </p>
      ) : null}
    </div>
  );
}
