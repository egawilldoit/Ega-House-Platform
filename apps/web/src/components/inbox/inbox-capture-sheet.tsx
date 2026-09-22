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
  idempotencyKey: string;
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

/**
 * The single Inbox Capture controller.
 *
 * Mount once per workspace shell (see GlobalQuickActionControllers). It owns the
 * capture sheet, draft persistence, and the INBOX_CAPTURE_EVENT listener.
 * Navigation surfaces only render triggers that dispatch the event.
 */
export function InboxCaptureSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(draft.title);
      setBody(draft.body);
      idempotencyKeyRef.current = draft.idempotencyKey || createIdempotencyKey();
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.requestAnimationFrame(() => {
      document.getElementById("inbox-capture-title")?.focus();
    });
    return () => window.cancelAnimationFrame(timer);
  }, [open]);

  useEffect(() => {
    if (!title && !body) {
      if (error) {
        saveDraft({ title, body, idempotencyKey: idempotencyKeyRef.current });
      }
      return;
    }
    saveDraft({ title, body, idempotencyKey: idempotencyKeyRef.current });
  }, [title, body, error]);

  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setError(null);
      setSuccess(null);
    };
    window.addEventListener(INBOX_CAPTURE_EVENT, handler);
    return () => window.removeEventListener(INBOX_CAPTURE_EVENT, handler);
  }, []);

  const closeSheet = useCallback(() => {
    setOpen(false);
    setError(null);
    setSuccess(null);
  }, []);

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
      saveDraft({ title, body, idempotencyKey: keyToUse });

      try {
        const result = await captureInboxIdea({
          title: trimmedTitle,
          body: body.trim() ? body.trim() : null,
          idempotencyKey: keyToUse,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSuccess("Idea captured.");
        setTitle("");
        setBody("");
        clearDraftStorage();
        idempotencyKeyRef.current = createIdempotencyKey();
        router.refresh();
        window.setTimeout(() => {
          setOpen(false);
          setSuccess(null);
        }, 600);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to capture idea right now.";
        setError(message);
      } finally {
        setPending(false);
      }
    },
    [title, body, router],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      closeSheet();
      return;
    }
    setOpen(true);
    setError(null);
    setSuccess(null);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        closeLabel="Close capture panel"
        className="flex flex-col"
        aria-label="Inbox quick capture sheet"
        data-testid="inbox-quick-capture-sheet"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 pb-4 pt-5 sm:px-6">
          <SheetHeader className="min-w-0">
            <p className="glass-label">Inbox Capture</p>
            <SheetTitle>Capture</SheetTitle>
            <SheetDescription>
              Write first. Smart Inbox keeps the raw capture intact while you decide what it becomes.
            </SheetDescription>
          </SheetHeader>

          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-9 w-9 shrink-0 rounded-full p-0"
            aria-label="Close inbox capture panel"
            onClick={closeSheet}
            data-testid="inbox-capture-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <form onSubmit={handleSubmit} className="space-y-4" aria-label="Inbox quick capture form">
            <div className="space-y-2">
              <label htmlFor="inbox-capture-title" className="glass-label text-etch">
                Thought
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
                aria-label="Inbox capture title"
                autoComplete="off"
              />
              <p className="text-xs leading-5 text-[color:var(--muted-foreground)]">
                Short raw thought — Project, priority, and tags are optional later.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="inbox-capture-body" className="glass-label text-etch">
                Context (optional)
              </label>
              <Textarea
                id="inbox-capture-body"
                name="body"
                placeholder="Add context, links, or next thoughts."
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-24 resize-none"
                data-testid="inbox-capture-body-input"
                aria-label="Inbox capture body"
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closeSheet}
                disabled={pending}
                data-testid="inbox-capture-cancel"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="muted"
                size="sm"
                onClick={() => {
                  closeSheet();
                  window.dispatchEvent(new CustomEvent(QUICK_TASK_EVENT));
                }}
                data-testid="open-quick-task-from-capture"
              >
                Create a task
              </Button>
              <Button
                type="submit"
                disabled={pending}
                data-testid="inbox-capture-submit"
                aria-label="Capture idea to inbox"
              >
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Capturing...
                  </>
                ) : (
                  "Capture"
                )}
              </Button>
            </div>
          </form>

          <p className="mt-4 text-xs text-[color:var(--muted-foreground)]">
            Press <kbd className="rounded border bg-white px-1 py-0.5 text-[10px]">Esc</kbd> to close.
            Shortcut: <kbd className="rounded border bg-white px-1 py-0.5 text-[10px]">Ctrl+Shift+I</kbd> to capture.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
