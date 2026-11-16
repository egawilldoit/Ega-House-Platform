"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { captureInboxIdea } from "@/components/inbox/capture-action";
import {
  clearQuickNoteDraft,
  createEmptyDraft,
  createIdempotencyKey,
  deriveNoteTitle,
  loadQuickNoteDraft,
  saveQuickNoteDraft,
  type QuickNoteDraft,
} from "@/lib/quick-notes/draft-storage";

export type QuickNotesSaveStatus =
  | "saved-locally"
  | "unsaved"
  | "saving"
  | "saved-to-backlog"
  | "error";

export type QuickNotesController = {
  text: string;
  status: QuickNotesSaveStatus;
  error: string | null;
  panelOpen: boolean;
  confirmNewNote: boolean;
  setText: (text: string) => void;
  openPanel: () => void;
  closePanel: () => void;
  save: () => void;
  requestNewNote: () => void;
  confirmNewNoteAction: () => void;
  cancelNewNote: () => void;
  dismissError: () => void;
};

function initialDraft(ownerUserId: string | null): QuickNoteDraft {
  return loadQuickNoteDraft(ownerUserId) ?? createEmptyDraft();
}

/**
 * Shell-scoped owner of unsaved Quick Notes state and the explicit Backlog
 * save. The draft is browser-local and account-scoped; the only product write
 * is the canonical `captureInboxIdea` server action under RLS. The workspace
 * layout keys the owning provider by verified owner id, so an account switch
 * remounts this hook and cannot carry another owner's live state.
 */
export function useQuickNotesController(
  ownerUserId: string | null,
): QuickNotesController {
  const router = useRouter();
  // The panel is closed on first render, so no draft-dependent markup is
  // server-rendered; loading the owner-scoped key here cannot mismatch hydration.
  const [draft, setDraft] = useState<QuickNoteDraft>(() =>
    initialDraft(ownerUserId),
  );
  const [status, setStatus] = useState<QuickNotesSaveStatus>(() =>
    draft.text ? "unsaved" : "saved-locally",
  );
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirmNewNote, setConfirmNewNote] = useState(false);

  const draftRef = useRef(draft);
  const ownerRef = useRef(ownerUserId);
  const saveInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const replaceDraft = useCallback((next: QuickNoteDraft) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const resetForNewNote = useCallback(() => {
    clearQuickNoteDraft(ownerRef.current);
    replaceDraft(createEmptyDraft());
    setError(null);
    setStatus("saved-locally");
    setConfirmNewNote(false);
  }, [replaceDraft]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (draft.text) {
      saveQuickNoteDraft(ownerRef.current, draft);
    } else {
      clearQuickNoteDraft(ownerRef.current);
    }
  }, [draft]);

  const setText = useCallback(
    (text: string) => {
      const previous = draftRef.current;
      const next: QuickNoteDraft =
        text === previous.keyText
          ? { ...previous, text }
          : { text, idempotencyKey: createIdempotencyKey(), keyText: text };
      replaceDraft(next);
      setConfirmNewNote(false);
      setError(null);
      setStatus(text.trim() ? "unsaved" : "saved-locally");
    },
    [replaceDraft],
  );

  const save = useCallback(() => {
    if (saveInFlightRef.current) {
      return;
    }
    const current = draftRef.current;
    if (!current.text.trim()) {
      return;
    }

    saveInFlightRef.current = true;
    setStatus("saving");
    setError(null);

    void (async () => {
      try {
        const result = await captureInboxIdea({
          title: deriveNoteTitle(current.text),
          body: current.text,
          idempotencyKey: current.idempotencyKey,
        });

        if (!mountedRef.current) {
          return;
        }

        if (!result.ok) {
          setError(result.error || "Unable to save the note right now.");
          setStatus("error");
          return;
        }

        if (draftRef.current.idempotencyKey === current.idempotencyKey) {
          resetForNewNote();
          setStatus("saved-to-backlog");
        } else {
          // The user started a new draft while the save was in flight. Clear
          // only the acknowledged payload, never the newer text.
          setStatus(draftRef.current.text.trim() ? "unsaved" : "saved-locally");
        }
        router.refresh();
      } catch {
        if (!mountedRef.current) {
          return;
        }
        setError("Unable to save the note right now. Check your connection.");
        setStatus("error");
      } finally {
        saveInFlightRef.current = false;
      }
    })();
  }, [resetForNewNote, router]);

  const requestNewNote = useCallback(() => {
    if (draftRef.current.text.trim()) {
      setConfirmNewNote(true);
      return;
    }
    resetForNewNote();
  }, [resetForNewNote]);

  return {
    text: draft.text,
    status,
    error,
    panelOpen,
    confirmNewNote,
    setText,
    openPanel: useCallback(() => setPanelOpen(true), []),
    closePanel: useCallback(() => {
      setPanelOpen(false);
      setConfirmNewNote(false);
    }, []),
    save,
    requestNewNote,
    confirmNewNoteAction: resetForNewNote,
    cancelNewNote: useCallback(() => setConfirmNewNote(false), []),
    dismissError: useCallback(() => {
      setError(null);
      setStatus((previous) =>
        previous === "error" ? "unsaved" : previous,
      );
    }, []),
  };
}
