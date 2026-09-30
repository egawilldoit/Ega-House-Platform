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
import { INBOX_CAPTURE_EVENT } from "@/lib/workspace-events";

export { INBOX_CAPTURE_EVENT } from "@/lib/workspace-events";

export const DRAFT_STORAGE_KEY = "ega:inbox-quick-capture-draft";

export type Draft = {
  title: string;
  body: string;
  projectId: string;
  idempotencyKey: string;
};

export function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `inbox-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function loadDraft(): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    const draft = parsed;
    const rawKey = typeof draft.idempotencyKey === "string" ? draft.idempotencyKey.trim() : "";
    const key = rawKey.length > 0 ? rawKey : createIdempotencyKey();
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      body: typeof parsed.body === "string" ? parsed.body : "",
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
      idempotencyKey: key,
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Ignore storage quota/security errors
  }
}

export function clearDraftStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export type InboxCapturePanelProps = {
  projects: Array<{ id: string; name: string }>;
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
    return loadDraft()?.title ?? "";
  });
  const [localProjectId, setLocalProjectId] = useState(() => {
    if (controlledProjectId !== undefined) return controlledProjectId;
    return loadDraft()?.projectId ?? "";
  });
  const [body, setBody] = useState(() => {
    return loadDraft()?.body ?? "";
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [initialKey] = useState(() => {
    const draft = loadDraft();
    if (!draft) return createIdempotencyKey();
    const rawKey = typeof draft.idempotencyKey === "string" ? draft.idempotencyKey.trim() : "";
    return rawKey.length > 0 ? rawKey : createIdempotencyKey();
  });
  const idempotencyKeyRef = useRef<string>(initialKey);

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
    const draft = loadDraft();
    if (draft && controlledTitle === undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(draft.title);
      setBody(draft.body);
      setProjectId(draft.projectId);
      const rawKey = typeof draft.idempotencyKey === "string" ? draft.idempotencyKey.trim() : "";
      const key = rawKey.length > 0 ? rawKey : createIdempotencyKey();
      idempotencyKeyRef.current = key;
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
      if (!idempotencyKeyRef.current || !idempotencyKeyRef.current.trim()) {
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
              rows={4}
              placeholder="Context, next step, link, or thought fragment..."
              value={body}
              onChange={(event) => setBody(event.target.value)}
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

export function InboxCaptureSheet({
  projects,
}: {
  projects: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(INBOX_CAPTURE_EVENT, handleOpen);
    return () => window.removeEventListener(INBOX_CAPTURE_EVENT, handleOpen);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        closeLabel="Close capture panel"
        className="flex flex-col"
        aria-label="Backlog quick capture sheet"
        data-testid="inbox-quick-capture-sheet"
      >
        <InboxCapturePanel
          projects={projects}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
