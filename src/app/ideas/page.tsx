import type { Metadata } from "next";
import Link from "next/link";
import { Filter, Inbox, Search } from "lucide-react";

import { CreateIdeaNoteForm } from "@/app/ideas/create-idea-note-form";
import { EditIdeaNoteForm } from "@/app/ideas/edit-idea-note-form";
import { IdeaNoteArchiveControls } from "@/app/ideas/idea-note-archive-controls";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  IDEA_NOTE_PRIORITIES,
  IDEA_NOTE_TYPES,
  MANUAL_IDEA_NOTE_STATUSES,
  getIdeaInboxNotes,
  getIdeaNoteProjectOptions,
  normalizeIdeaNoteListFilters,
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
    q?: string;
    search?: string;
    type?: string;
    status?: string;
    project?: string;
    priority?: string;
    tag?: string;
  }>;
};

const IDEA_NOTE_VIEWS = ["active", "archived", "all"] as const satisfies readonly IdeaNoteListView[];

function normalizeIdeaNoteView(value: string | undefined): IdeaNoteListView {
  return IDEA_NOTE_VIEWS.includes(value as IdeaNoteListView)
    ? (value as IdeaNoteListView)
    : "active";
}

function getIdeaViewHref(
  view: IdeaNoteListView,
  params: Awaited<IdeasPageProps["searchParams"]>,
) {
  const nextParams = new URLSearchParams();

  if (view !== "active") {
    nextParams.set("view", view);
  }

  for (const key of ["q", "type", "status", "project", "priority", "tag"] as const) {
    const value = params[key]?.trim();
    if (value) {
      nextParams.set(key, value);
    }
  }

  const query = nextParams.toString();
  return query ? `/ideas?${query}` : "/ideas";
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
  const filters = normalizeIdeaNoteListFilters({
    view: activeView,
    search: resolvedSearchParams.q ?? resolvedSearchParams.search,
    type: resolvedSearchParams.type,
    status: resolvedSearchParams.status,
    project: resolvedSearchParams.project,
    priority: resolvedSearchParams.priority,
    tag: resolvedSearchParams.tag,
  });
  const hasActiveFilters =
    Boolean(filters.search) ||
    filters.type !== "all" ||
    filters.status !== "all" ||
    filters.project !== "all" ||
    filters.priority !== "all" ||
    Boolean(filters.tag);
  const copy = getIdeaViewCopy(activeView);
  const [notes, projectOptions] = await Promise.all([
    getIdeaInboxNotes({ filters }),
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
                href={getIdeaViewHref("active", resolvedSearchParams)}
                className={cn(
                  buttonVariants({ variant: activeView === "active" ? "default" : "muted", size: "sm" }),
                  "rounded-xl",
                )}
              >
                Active
              </Link>
              <Link
                href={getIdeaViewHref("archived", resolvedSearchParams)}
                className={cn(
                  buttonVariants({ variant: activeView === "archived" ? "default" : "muted", size: "sm" }),
                  "rounded-xl",
                )}
              >
                Archived
              </Link>
              <Link
                href={getIdeaViewHref("all", resolvedSearchParams)}
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
          <CardContent className="space-y-4">
            <form
              action="/ideas"
              method="get"
              className="rounded-[1rem] border border-[rgba(15,23,42,0.08)] bg-white/70 p-3"
            >
              <input type="hidden" name="view" value={activeView} />
              <div className="grid gap-3 md:grid-cols-[minmax(180px,1.5fr)_repeat(5,minmax(120px,1fr))]">
                <div className="space-y-2">
                  <label htmlFor="idea-filter-q" className="glass-label text-etch">
                    Search
                  </label>
                  <Input
                    id="idea-filter-q"
                    name="q"
                    defaultValue={filters.search}
                    placeholder="Title or body"
                    className="ega-glass-input h-10 rounded-xl"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="idea-filter-type" className="glass-label text-etch">
                    Type
                  </label>
                  <select
                    id="idea-filter-type"
                    name="type"
                    defaultValue={filters.type}
                    className="ega-glass-input h-10 w-full rounded-xl px-3 text-sm"
                  >
                    <option value="all">All types</option>
                    {IDEA_NOTE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {formatTaskToken(type)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="idea-filter-status" className="glass-label text-etch">
                    Status
                  </label>
                  <select
                    id="idea-filter-status"
                    name="status"
                    defaultValue={filters.status}
                    className="ega-glass-input h-10 w-full rounded-xl px-3 text-sm"
                  >
                    <option value="all">All statuses</option>
                    {MANUAL_IDEA_NOTE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {formatTaskToken(status)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="idea-filter-project" className="glass-label text-etch">
                    Project
                  </label>
                  <select
                    id="idea-filter-project"
                    name="project"
                    defaultValue={filters.project}
                    className="ega-glass-input h-10 w-full rounded-xl px-3 text-sm"
                  >
                    <option value="all">All projects</option>
                    <option value="none">No project</option>
                    {projectOptions.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="idea-filter-priority" className="glass-label text-etch">
                    Priority
                  </label>
                  <select
                    id="idea-filter-priority"
                    name="priority"
                    defaultValue={filters.priority}
                    className="ega-glass-input h-10 w-full rounded-xl px-3 text-sm"
                  >
                    <option value="all">All priorities</option>
                    <option value="none">No priority</option>
                    {IDEA_NOTE_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {formatTaskToken(priority)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="idea-filter-tag" className="glass-label text-etch">
                    Tag
                  </label>
                  <Input
                    id="idea-filter-tag"
                    name="tag"
                    defaultValue={filters.tag}
                    placeholder="ops"
                    className="ega-glass-input h-10 rounded-xl"
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm" className="gap-2 rounded-xl">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Apply filters
                </Button>
                <Link href="/ideas" className={cn(buttonVariants({ variant: "muted", size: "sm" }), "rounded-xl")}>
                  Clear filters
                </Link>
                {hasActiveFilters ? (
                  <span className="inline-flex items-center gap-1 text-xs text-[color:var(--muted-foreground)]">
                    <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                    {notes.length} matching {notes.length === 1 ? "idea" : "ideas"}
                  </span>
                ) : null}
              </div>
            </form>

            {notes.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={hasActiveFilters ? "No ideas match these filters" : copy.emptyTitle}
                description={hasActiveFilters ? "Clear or adjust the filters to widen the inbox." : copy.emptyDescription}
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
