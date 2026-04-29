import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";

import { CreateIdeaNoteForm } from "@/app/ideas/create-idea-note-form";
import { EditIdeaNoteForm } from "@/app/ideas/edit-idea-note-form";
import { IdeaNoteArchiveControls } from "@/app/ideas/idea-note-archive-controls";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getIdeaInboxNotes,
  getIdeaNoteProjectOptions,
  type IdeaNoteListView,
} from "@/lib/services/idea-note-service";
import { formatTaskToken } from "@/lib/task-domain";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Ideas",
  description: "Capture loose ideas before they become tasks.",
};

function formatIdeaCreatedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type IdeasPageProps = {
  searchParams: Promise<{
    view?: string;
  }>;
};

const IDEA_NOTE_VIEWS = ["active", "archived", "all"] as const satisfies readonly IdeaNoteListView[];

function normalizeIdeaNoteView(value: string | undefined): IdeaNoteListView {
  return IDEA_NOTE_VIEWS.includes(value as IdeaNoteListView)
    ? (value as IdeaNoteListView)
    : "active";
}

function getIdeaViewCopy(view: IdeaNoteListView) {
  if (view === "archived") {
    return {
      title: "Archived ideas",
      description: "Ideas removed from active processing but kept recoverable.",
      emptyTitle: "No archived ideas yet",
      emptyDescription: "Archived ideas will appear here after you remove them from the active inbox.",
      countLabel: "archived",
    };
  }

  if (view === "all") {
    return {
      title: "All ideas",
      description: "Active and archived ideas, excluding converted notes.",
      emptyTitle: "No ideas captured yet",
      emptyDescription: "Capture a thought, improvement, or opportunity and keep it separate from tasks until you are ready to process it.",
      countLabel: "ideas",
    };
  }

  return {
    title: "Ideas",
    description: "Newest active ideas and their current processing status.",
    emptyTitle: "No active ideas",
    emptyDescription: "Capture a thought, improvement, or opportunity and keep it separate from tasks until you are ready to process it.",
    countLabel: "active",
  };
}

export default async function IdeasPage({ searchParams }: IdeasPageProps) {
  const resolvedSearchParams = await searchParams;
  const activeView = normalizeIdeaNoteView(resolvedSearchParams.view);
  const copy = getIdeaViewCopy(activeView);
  const [notes, projectOptions] = await Promise.all([
    getIdeaInboxNotes({ view: activeView }),
    getIdeaNoteProjectOptions(),
  ]);

  return (
    <AppShell
      eyebrow="Ideas Inbox"
      title="Ideas"
      description="Capture loose thoughts, opportunities, and follow-ups before deciding what they become."
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(320px,420px)_1fr]">
        <Card className="border-[var(--border)] bg-white">
          <CardHeader>
            <CardTitle>Capture</CardTitle>
            <CardDescription>
              Add an inbox note without turning it into execution work yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateIdeaNoteForm projectOptions={projectOptions} />
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-white">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>{copy.title}</CardTitle>
              <CardDescription>
                {copy.description}
              </CardDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Link
                href="/ideas"
                className={cn(
                  buttonVariants({ variant: activeView === "active" ? "default" : "muted", size: "sm" }),
                  "rounded-xl",
                )}
              >
                Active
              </Link>
              <Link
                href="/ideas?view=archived"
                className={cn(
                  buttonVariants({ variant: activeView === "archived" ? "default" : "muted", size: "sm" }),
                  "rounded-xl",
                )}
              >
                Archived
              </Link>
              <Link
                href="/ideas?view=all"
                className={cn(
                  buttonVariants({ variant: activeView === "all" ? "default" : "muted", size: "sm" }),
                  "rounded-xl",
                )}
              >
                All
              </Link>
              <Badge tone="info">
                {notes.length} {copy.countLabel}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {notes.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={copy.emptyTitle}
                description={copy.emptyDescription}
              />
            ) : (
              <div className="space-y-3">
                {notes.map((note) => (
                  <article
                    key={note.id}
                    className="ega-glass-soft rounded-[1.1rem] border border-[rgba(15,23,42,0.08)] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-[color:var(--foreground)]">
                          {note.title}
                        </h2>
                        <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                          {formatIdeaCreatedAt(note.created_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Badge tone="info">{formatTaskToken(note.type)}</Badge>
                        <Badge tone="muted">{formatTaskToken(note.status)}</Badge>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge tone="muted">
                        {note.projects?.name ?? "No project"}
                      </Badge>
                      {note.priority ? (
                        <Badge tone="warn">{formatTaskToken(note.priority)}</Badge>
                      ) : null}
                      {note.tags.map((tag) => (
                        <Badge key={tag} tone="muted">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    {note.body ? (
                      <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-[color:var(--muted-foreground)]">
                        {note.body}
                      </p>
                    ) : null}
                    {note.status === "archived" ? (
                      <IdeaNoteArchiveControls noteId={note.id} mode="restore" />
                    ) : (
                      <>
                        <IdeaNoteArchiveControls noteId={note.id} mode="archive" />
                        <EditIdeaNoteForm note={note} projectOptions={projectOptions} />
                      </>
                    )}
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
