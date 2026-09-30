"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { captureInboxIdea } from "./capture-action";
import { QUICK_TASK_EVENT, INBOX_CAPTURE_EVENT } from "@/lib/workspace-events";

export { INBOX_CAPTURE_EVENT } from "@/lib/workspace-events";

const DRAFT_STORAGE_KEY = "ega:inbox-quick-capture-draft";

type Draft = {
  title: string;
  body: string;
  projectId: string;
  idempotencyKey: string;
};

export type InboxCaptureSheetProps = {
  projects?: { id: string; name: string }[];
};

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadDraft(): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (typeof parsed.title !== "string") return null;
    return {
      title: parsed.title ?? "",
      body: typeof parsed.body === "string" ? parsed.body : "",
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
      idempotencyKey: typeof parsed.idempotencyKey === "string" && parsed.idempotencyKey.trim()
        ? parsed.idempotencyKey.trim()
        : createIdempotencyKey(),
    };
  } catch {
    return null;
  }
}

function saveDraft(draft: Draft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {}
}

function clearDraftStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {}
}

export type InboxCapturePanelProps = {
  projects?: { id: string; name: string }[];
  title?: string;
  onTitleChange?: (title: string) => void;
  projectId?: string;
  onProjectIdChange?: (projectId: string) => void;
  onSuccess?: () => void;
  onCancel?: () => void;
  hideHeader?: boolean;
};

export function InboxCapturePanel({
  projects = [],
  title: controlledTitle,
  onTitleChange,
  projectId: controlledProjectId,
  onProjectIdChange,
  onSuccess,
  onCancel,
  hideHeader = false,
}: InboxCapturePanelProps) {
  const router = useRouter();
  const [localTitle, setLocalTitle] = useState(controlledTitle ?? "");
  const [body, setBody] = useState("");
  const [localProjectId, setLocalProjectId] = useState(controlledProjectId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

  const title = controlledTitle !== undefined ? controlledTitle : localTitle;
  const projectId = controlledProjectId !== undefined ? controlledProjectId : localProjectId;

  const setTitle = useCallback(
    (nextTitle: string) => {
      setLocalTitle(nextTitle);
      onTitleChange?.(nextTitle);
    },
    [onTitleChange],
  );

  const setProjectId = useCallback(
    (nextProjectId: string) => {
      setLocalProjectId(nextProjectId);
      onProjectIdChange?.(nextProjectId);
    },
    [onProjectIdChange],
  );

  useEffect(() => {
    if (controlledTitle !== undefined && controlledTitle !== localTitle) {
      setLocalTitle(controlledTitle);
    }
  }, [controlledTitle, localTitle]);

  useEffect(() => {
    if (controlledProjectId !== undefined && controlledProjectId !== localProjectId) {
      setLocalProjectId(controlledProjectId);
    }
  }, [controlledProjectId, localProjectId]);

  useEffect(() => {
    const draft = loadDraft();
    if (draft && !controlledTitle) {
      setTitle(draft.title);
      setBody(draft.body);
      setProjectId(draft.projectId);
      idempotencyKeyRef.current = draft.idempotencyKey || createIdempotencyKey();
    }
  }, [controlledTitle, setProjectId, setTitle]);

  useEffect(() => {
    const timer = window.requestAnimationFrame(() => {
      document.getElementById("inbox-capture-title")?.focus();
    });
    return () => window.cancelAnimationFrame(timer);
  }, []);

  useEffect(() => {
    if (!title && !body && !projectId) {
      if (error) {
        saveDraft({ title, body, projectId, idempotencyKey: idempotencyKeyRef.current });
      }
      return;
    }
    saveDraft({ title, body, projectId, idempotencyKey: idempotencyKeyRef.current });
  }, [title, body, projectId, error]);

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
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = createIdempotencyKey();
      }
      const keyToUse = idempotencyKeyRef.current;
      saveDraft({ title, body, projectId, idempotencyKey: keyToUse });

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
        clearDraftStorage();
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
    [title, body, projectId, router, onSuccess, setProjectId, setTitle],
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
              placeholder="Add context, links, or next thoughts."
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="min-h-24 resize-none"
              data-testid="inbox-capture-body-input"
              aria-label="Backlog capture notes"
            />
          </div>

          {error ? (
            <div role="alert" className="feedback-block feedback-block-error" data-testid="inbox-capture-error">
              {error}
            </div>
          ) : null}

          {success ? (
            <div role="status" className="feedback-block feedback-block-success" data-testid="inbox-capture-success">
              {success}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] pt-4">
            {onCancel ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={pending}
                data-testid="inbox-capture-cancel"
              >
                Cancel
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={pending}
              data-testid="inbox-capture-submit"
              aria-label="Add to Backlog"
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Adding...
                </>
              ) : (
                "Add to Backlog"
              )}
            </Button>
          </div>
        </form>

        <p className="mt-4 text-xs text-[color:var(--muted-foreground)]">
          Press <kbd className="rounded border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1 py-0.5 text-[length:var(--text-micro)]">Esc</kbd> to close.
          Shortcut: <kbd className="rounded border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1 py-0.5 text-[length:var(--text-micro)]">Ctrl+Shift+I</kbd> to capture.
        </p>
      </div>
    </>
  );
}

/**
 * The single Backlog Capture controller.
 *
 * Mount once per workspace shell (see GlobalQuickActionControllers). It owns the
 * capture sheet, draft persistence, and the INBOX_CAPTURE_EVENT listener.
 * Navigation surfaces only render triggers that dispatch the event.
 */
export function InboxCaptureSheet({ projects = [] }: InboxCaptureSheetProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => {
      setOpen(true);
    };
    window.addEventListener(INBOX_CAPTURE_EVENT, handler);
    return () => window.removeEventListener(INBOX_CAPTURE_EVENT, handler);
  }, []);

  const closeSheet = useCallback(() => {
    setOpen(false);
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      closeSheet();
      return;
    }
    setOpen(true);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        closeLabel="Close capture panel"
        className="flex flex-col"
        aria-label="Backlog quick capture sheet"
        data-testid="inbox-quick-capture-sheet"
      >
        <InboxCapturePanel
          projects={projects}
          onSuccess={closeSheet}
          onCancel={closeSheet}
          hideHeader={false}
        />
      </SheetContent>
    </Sheet>
  );
}
