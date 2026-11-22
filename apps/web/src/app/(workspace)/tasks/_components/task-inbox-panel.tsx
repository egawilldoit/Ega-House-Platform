"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Archive, Inbox, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { captureInboxIdea } from "@/components/inbox/capture-action";
import {
  captureKeyContent,
  clearInboxCaptureDraft,
  clearInboxCaptureDraftIfUnchanged,
  createEmptyCaptureDraft,
  createIdempotencyKey,
  loadInboxCaptureDraft,
  saveInboxCaptureDraft,
  type InboxCaptureDraft,
} from "@/lib/inbox-capture/draft-storage";
import type { IdeaNote, IdeaNoteProjectOption } from "@/lib/services/idea-note-service";
import {
  archiveTaskInboxItemAction,
  convertTaskInboxItemAction,
  type ConvertTaskInboxItemFormState,
  type TaskInboxItemFormState,
} from "../inbox-actions";

const INITIAL_ITEM_STATE: TaskInboxItemFormState = { error: null, success: null };
const INITIAL_CONVERT_STATE: ConvertTaskInboxItemFormState = { error: null };

function formatIdeaAge(value: string) {
  const createdAt = new Date(value).getTime();
  if (Number.isNaN(createdAt)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - createdAt) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function CaptureForm({
  ownerId,
  projects,
}: {
  ownerId: string | null;
  projects: IdeaNoteProjectOption[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<InboxCaptureDraft>(() =>
    loadInboxCaptureDraft(ownerId) ?? createEmptyCaptureDraft(),
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);

  const replaceDraft = useCallback(
    (next: InboxCaptureDraft) => {
      draftRef.current = next;
      setDraft(next);
    },
    [],
  );

  useEffect(() => {
    if (draft.title || draft.body || draft.projectId) {
      saveInboxCaptureDraft(ownerId, draft);
    } else {
      clearInboxCaptureDraft(ownerId);
    }
  }, [draft, ownerId]);

  const updateField = useCallback(
    (field: "title" | "body" | "projectId", value: string) => {
      const previous = draftRef.current;
      const next = { ...previous, [field]: value };
      const nextKeyContent = captureKeyContent(next);
      replaceDraft({
        ...next,
        keyContent: nextKeyContent,
        idempotencyKey:
          nextKeyContent === previous.keyContent
            ? previous.idempotencyKey
            : createIdempotencyKey(),
      });
      setError(null);
    },
    [replaceDraft],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      setError("Title is required.");
      return;
    }

    setPending(true);
    setError(null);
    const acknowledged = draftRef.current;
    saveInboxCaptureDraft(ownerId, acknowledged);

    try {
      const result = await captureInboxIdea({
        title,
        body: acknowledged.body.trim() || null,
        projectId: acknowledged.projectId.trim() || null,
        idempotencyKey: acknowledged.idempotencyKey,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      clearInboxCaptureDraftIfUnchanged(ownerId, acknowledged);
      replaceDraft(createEmptyCaptureDraft());
      setDetailsOpen(false);
      router.refresh();
    } catch {
      setError("Unable to capture the idea right now.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-b border-[var(--ega-divider)] px-[18px] py-3"
      aria-label="Capture an idea"
      data-testid="task-inbox-capture"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="task-inbox-capture-title" className="sr-only">
            Idea
          </label>
          <Input
            id="task-inbox-capture-title"
            name="title"
            value={draft.title}
            onChange={(event) => updateField("title", event.target.value)}
            placeholder="Capture an idea for later…"
            autoComplete="off"
            className="h-10"
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={pending || !draft.title.trim()}
          className="h-10 shrink-0 px-3"
        >
          {pending ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              Capturing…
            </>
          ) : (
            <>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Capture
            </>
          )}
        </Button>
      </div>

      <details
        className="mt-2"
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer list-none text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)] hover:text-[color:var(--ega-text-secondary)]">
          Notes and project
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            Notes
            <Textarea
              name="body"
              rows={2}
              value={draft.body}
              onChange={(event) => updateField("body", event.target.value)}
              placeholder="Context, next step, link…"
            />
          </label>
          <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            Project
            <select
              name="projectId"
              value={draft.projectId}
              onChange={(event) => updateField("projectId", event.target.value)}
              className="input-instrument h-9 w-full px-2 text-sm"
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>

      {error ? (
        <p role="alert" className="mt-2 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function ConvertIdeaForm({
  note,
  projects,
}: {
  note: IdeaNote;
  projects: IdeaNoteProjectOption[];
}) {
  const [state, formAction, pending] = useActionState(
    convertTaskInboxItemAction,
    INITIAL_CONVERT_STATE,
  );

  return (
    <details className="text-[length:var(--text-meta)]">
      <summary className="cursor-pointer list-none text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]">
        Turn into task
      </summary>
      <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={note.id} />
        <label className="flex flex-col gap-1 text-[color:var(--ega-text-tertiary)]">
          Project
          <select
            name="projectId"
            required
            defaultValue={note.project_id ?? ""}
            className="input-instrument h-8 min-w-40 px-2 text-xs"
          >
            <option value="">Choose a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={pending || projects.length === 0}
          className="h-8 px-2 text-xs"
        >
          <ArrowRight className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {pending ? "Converting…" : "Create task"}
        </Button>
        {state.error ? (
          <p role="alert" className="text-[color:var(--status-overdue)]">
            {state.error}
          </p>
        ) : null}
      </form>
    </details>
  );
}

function ArchiveIdeaForm({ noteId }: { noteId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    archiveTaskInboxItemAction,
    INITIAL_ITEM_STATE,
  );

  useEffect(() => {
    if (state.success) {
      router.refresh();
    }
  }, [router, state.success]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={noteId} />
      <Button
        type="submit"
        variant="muted"
        size="sm"
        disabled={pending}
        className="h-7 px-2 text-xs"
      >
        <Archive className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        {pending ? "Archiving…" : "Archive"}
      </Button>
      {state.error ? (
        <p role="alert" className="text-[length:var(--text-meta)] text-[color:var(--status-overdue)]">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function TaskInboxPanel({
  ideas,
  projects,
  ownerId,
  loadError,
}: {
  ideas: IdeaNote[];
  projects: IdeaNoteProjectOption[];
  ownerId: string | null;
  loadError?: string | null;
}) {
  return (
    <div data-testid="task-inbox-panel">
      <CaptureForm ownerId={ownerId} projects={projects} />

      {loadError ? (
        <p role="alert" className="m-[18px] feedback-block feedback-block-error">
          {loadError}
        </p>
      ) : ideas.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Inbox is empty"
          description="Capture an idea above. It stays here until you turn it into a task."
        />
      ) : (
        <ul className="rows" aria-label="Captured ideas">
          {ideas.map((note) => (
            <li
              key={note.id}
              className="flex flex-col gap-2 border-b border-[var(--ega-divider)] px-[18px] py-3 last:border-b-0"
              data-testid={`task-inbox-item-${note.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[color:var(--ega-text)]">
                  {note.title}
                </span>
                <Badge tone="muted">{note.projects?.name ?? "No project"}</Badge>
                <time
                  dateTime={note.created_at}
                  className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]"
                >
                  {formatIdeaAge(note.created_at)}
                </time>
              </div>
              {note.body ? (
                <p className="max-w-[80ch] whitespace-pre-wrap text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                  {note.body}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <ConvertIdeaForm note={note} projects={projects} />
                <ArchiveIdeaForm noteId={note.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
