"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { captureInboxIdea } from "./capture-action";
import {
  captureKeyContent,
  clearInboxCaptureDraft,
  createEmptyCaptureDraft,
  createIdempotencyKey,
  loadInboxCaptureDraft,
  saveInboxCaptureDraft,
  type InboxCaptureDraft,
} from "@/lib/inbox-capture/draft-storage";
export { INBOX_CAPTURE_EVENT } from "@/lib/workspace-events";
export {
  createIdempotencyKey,
  inboxCaptureStorageKey,
} from "@/lib/inbox-capture/draft-storage";

/** @deprecated Legacy global key retained only for migration cleanup. */
export const DRAFT_STORAGE_KEY = "ega:inbox-quick-capture-draft";

export type Draft = InboxCaptureDraft;

export function loadDraft(ownerUserId: string | null = null): Draft | null {
  return loadInboxCaptureDraft(ownerUserId);
}

export function saveDraft(draft: Draft, ownerUserId: string | null = null) {
  saveInboxCaptureDraft(ownerUserId, draft);
}

export function clearDraftStorage(ownerUserId: string | null = null) {
  clearInboxCaptureDraft(ownerUserId);
}

export type InboxCapturePanelProps = {
  projects: Array<{ id: string; name: string }>;
  /**
   * Verified owner id. Draft persistence is owner-scoped so an account switch
   * can never reveal another account's unsaved capture.
   */
  ownerId?: string | null;
  onSuccess?: () => void;
  onCancel?: () => void;
  hideHeader?: boolean;
  title?: string;
  onTitleChange?: (title: string) => void;
  projectId?: string;
  onProjectIdChange?: (projectId: string) => void;
};

export function InboxCapturePanel({
  projects,
  ownerId = null,
  onSuccess,
  onCancel,
  hideHeader = false,
  title: controlledTitle,
  onTitleChange,
  projectId: controlledProjectId,
  onProjectIdChange,
}: InboxCapturePanelProps) {
  const router = useRouter();
  const [localTitle, setLocalTitle] = useState(() => {
    if (controlledTitle !== undefined) return controlledTitle;
    return loadDraft(ownerId)?.title ?? "";
  });
  const [localProjectId, setLocalProjectId] = useState(() => {
    if (controlledProjectId !== undefined) return controlledProjectId;
    return loadDraft(ownerId)?.projectId ?? "";
  });
  const [body, setBody] = useState(() => {
    return loadDraft(ownerId)?.body ?? "";
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [initialDraft] = useState(
    () => loadDraft(ownerId) ?? createEmptyCaptureDraft(),
  );
  const idempotencyKeyRef = useRef<string>(initialDraft.idempotencyKey);
  const keyContentRef = useRef<string>(initialDraft.keyContent);

  const title = controlledTitle !== undefined ? controlledTitle : localTitle;
  const projectId = controlledProjectId !== undefined ? controlledProjectId : localProjectId;

  const rememberKeyContent = useCallback(
    (next: { title: string; body: string; projectId: string }) => {
      const nextKeyContent = captureKeyContent(next);
      if (nextKeyContent !== keyContentRef.current) {
        keyContentRef.current = nextKeyContent;
        idempotencyKeyRef.current = createIdempotencyKey();
      }
    },
    [],
  );

  const setTitle = useCallback(
    (nextTitle: string) => {
      setLocalTitle(nextTitle);
      rememberKeyContent({ title: nextTitle, body, projectId });
      onTitleChange?.(nextTitle);
    },
    [body, onTitleChange, projectId, rememberKeyContent],
  );

  const setProjectId = useCallback(
    (nextProjectId: string) => {
      setLocalProjectId(nextProjectId);
      rememberKeyContent({ title, body, projectId: nextProjectId });
      onProjectIdChange?.(nextProjectId);
    },
    [body, onProjectIdChange, rememberKeyContent, title],
  );

  const setBodyText = useCallback(
    (nextBody: string) => {
      setBody(nextBody);
      rememberKeyContent({ title, body: nextBody, projectId });
    },
    [projectId, rememberKeyContent, title],
  );

  useEffect(() => {
    const draft = loadDraft(ownerId);
    if (draft && controlledTitle === undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(draft.title);
      setBody(draft.body);
      setProjectId(draft.projectId);
      idempotencyKeyRef.current = draft.idempotencyKey;
      keyContentRef.current = draft.keyContent;
    }
  }, [controlledTitle, ownerId, setProjectId, setTitle]);

  useEffect(() => {
    const timer = window.requestAnimationFrame(() => {
      document.getElementById("inbox-capture-title")?.focus();
    });
    return () => window.cancelAnimationFrame(timer);
  }, []);

  useEffect(() => {
    if (!title && !body && !projectId) {
      if (error) {
        saveDraft(
          {
            title,
            body,
            projectId,
            idempotencyKey: idempotencyKeyRef.current,
            keyContent: keyContentRef.current,
          },
          ownerId,
        );
      }
      return;
    }
    saveDraft(
      {
        title,
        body,
        projectId,
        idempotencyKey: idempotencyKeyRef.current,
        keyContent: keyContentRef.current,
      },
      ownerId,
    );
  }, [title, body, projectId, error, ownerId]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        setError("Title is required.");
        return;
      }
      setPending(true);
      setError(null);
      setSuccess(null);
      const currentKeyContent = captureKeyContent({ title, body, projectId });
      if (currentKeyContent !== keyContentRef.current) {
        keyContentRef.current = currentKeyContent;
        idempotencyKeyRef.current = createIdempotencyKey();
      }
      if (!idempotencyKeyRef.current || !idempotencyKeyRef.current.trim()) {
        idempotencyKeyRef.current = createIdempotencyKey();
      }
      const keyToUse = idempotencyKeyRef.current;
      const draftToSave: Draft = {
        title,
        body,
        projectId,
        idempotencyKey: keyToUse,
        keyContent: keyContentRef.current,
      };
      saveDraft(draftToSave, ownerId);

      try {
        const result = await captureInboxIdea({
          title: trimmedTitle,
          body: body.trim() ? body.trim() : null,
          projectId: projectId.trim() || null,
          idempotencyKey: keyToUse,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSuccess("Added to Backlog.");
        setTitle("");
        setBody("");
        setProjectId("");
        clearDraftStorage(ownerId);
        idempotencyKeyRef.current = createIdempotencyKey();
        router.refresh();
        window.setTimeout(() => {
          onSuccess?.();
          setSuccess(null);
        }, 600);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to capture idea right now.";
        setError(message);
      } finally {
        setPending(false);
      }
    },
    [title, body, projectId, router, onSuccess, setProjectId, setTitle, ownerId],
  );

  return (
    <>
      {!hideHeader && (
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 pb-4 pt-5 sm:px-6">
          <SheetHeader className="min-w-0">
            <p className="glass-label">Backlog Capture</p>
            <SheetTitle>Add to Backlog</SheetTitle>
            <SheetDescription>
              Capture an idea now. Keep it here until it is ready to become real work.
            </SheetDescription>
          </SheetHeader>

          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-9 w-9 shrink-0 rounded-full p-0"
            aria-label="Close backlog capture panel"
            onClick={onCancel}
            data-testid="inbox-capture-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        <form onSubmit={handleSubmit} className="space-y-4" aria-label="Backlog quick capture form">
          <div className="space-y-2">
            <label htmlFor="inbox-capture-title" className="form-label">
              Idea
            </label>
            <Input
              id="inbox-capture-title"
              name="title"
              required
              placeholder="Follow up on onboarding insight"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-10"
              data-testid="inbox-capture-title-input"
              aria-label="Backlog capture title"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="inbox-capture-project" className="form-label">
              Project (optional)
            </label>
            <select
              id="inbox-capture-project"
              name="projectId"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="input-instrument h-10 w-full px-2.5 text-[length:var(--text-meta-lg)]"
              data-testid="inbox-capture-project-input"
              aria-label="Backlog capture project"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="inbox-capture-body" className="form-label">
              Notes (optional)
            </label>
            <Textarea
              id="inbox-capture-body"
              name="body"
              rows={4}
              placeholder="Context, next step, link, or thought fragment..."
              value={body}
              onChange={(event) => setBodyText(event.target.value)}
              data-testid="inbox-capture-body-input"
              aria-label="Backlog capture notes"
            />
          </div>

          {error && (
            <p className="status-banner status-banner-error text-xs" role="alert" data-testid="inbox-capture-error">
              {error}
            </p>
          )}

          {success && (
            <p className="status-banner status-banner-success text-xs" role="status" data-testid="inbox-capture-success">
              {success}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              disabled={pending || !title.trim()}
              data-testid="inbox-capture-submit"
            >
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Add to Backlog"
              )}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
