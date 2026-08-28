"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { captureInboxIdea } from "./capture-action";

const DRAFT_STORAGE_KEY = "ega:inbox-quick-capture-draft";
export const INBOX_CAPTURE_EVENT = "ega:open-inbox-capture";

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

export function InboxQuickCapture() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());
  // Restore draft on mount and when opening
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
    // When opening, focus the title input
    const timer = window.requestAnimationFrame(() => {
      document.getElementById("inbox-capture-title")?.focus();
    });
    return () => window.cancelAnimationFrame(timer);
  }, [open]);

  // Persist draft whenever title/body/key changes while open or on change
  useEffect(() => {
    if (!title && !body) {
      // Do not store empty draft if no content; but keep key for retry if pending failure?
      // We still store if we have a pending key and error (to preserve retry key)
      if (error) {
        saveDraft({ title, body, idempotencyKey: idempotencyKeyRef.current });
      }
      return;
    }
    saveDraft({ title, body, idempotencyKey: idempotencyKeyRef.current });
  }, [title, body, error]);

  // Listen for global shortcut event
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
    // Do not clear draft on close if there is pending error? Keep draft for retry.
    // Only clear error/success when closing via explicit close; draft remains in storage.
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
      // Ensure we have a stable key for this attempt; reuse existing key for retries until success
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = createIdempotencyKey();
      }
      const keyToUse = idempotencyKeyRef.current;
      // Persist draft before network call (so retry has same key)
      saveDraft({ title, body, idempotencyKey: keyToUse });

      try {
        const result = await captureInboxIdea({
          title: trimmedTitle,
          body: body.trim() ? body.trim() : null,
          idempotencyKey: keyToUse,
        });
        if (!result.ok) {
          // Preserve draft and key for retry; do not claim success
          setError(result.error);
          return;
        }
        // Success: clear draft and key, reset form, update UI without full-page refresh
        setSuccess("Idea captured.");
        setTitle("");
        setBody("");
        clearDraftStorage();
        idempotencyKeyRef.current = createIdempotencyKey();
        // Update local/query state without full-page refresh: router.refresh triggers soft revalidation
        router.refresh();
        // Small delay then close to show success feedback
        window.setTimeout(() => {
          setOpen(false);
          setSuccess(null);
        }, 600);
      } catch (err) {
        // Network or unexpected failure: keep draft, show error, never report false success
        const message = err instanceof Error ? err.message : "Unable to capture idea right now.";
        setError(message);
        // draft already saved, key preserved for retry
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
      <SheetTrigger asChild>
        <Button
          className="mx-2.5 mt-2 h-auto w-[calc(100%-1.25rem)] items-center justify-start gap-2.5 rounded-xl border border-[rgba(37,99,235,0.28)] bg-[linear-gradient(135deg,#2563EB,#1D4ED8)] px-3 py-2.5 text-left text-white shadow-[0_12px_26px_rgba(37,99,235,0.22),inset_0_1px_0_rgba(255,255,255,0.18)] hover:border-[rgba(37,99,235,0.38)] hover:bg-[linear-gradient(135deg,#1D4ED8,#1E40AF)]"
          aria-label="Capture idea to Inbox"
          data-testid="inbox-quick-capture-trigger"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
            <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-5 tracking-normal">Capture idea</span>
            <span className="mt-0.5 block text-xs font-semibold leading-4 text-white/78">
              Quick inbox, no project needed.
            </span>
          </span>
        </Button>
      </SheetTrigger>

      <SheetContent
        className="flex flex-col"
        aria-label="Inbox quick capture sheet"
        data-testid="inbox-quick-capture-sheet"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 pb-4 pt-5 sm:px-6">
          <SheetHeader className="min-w-0">
            <p className="glass-label text-signal-live">Inbox Capture</p>
            <SheetTitle>Capture idea</SheetTitle>
            <SheetDescription>
              Save a raw thought to your Inbox without choosing a Project or priority. You can organize it later.
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
                  "Capture idea"
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
