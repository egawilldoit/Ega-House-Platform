import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Filter, Inbox, Search } from "lucide-react";

import { CreateIdeaNoteForm } from "@/app/ideas/create-idea-note-form";
import { ConvertIdeaNoteForm } from "@/app/ideas/convert-idea-note-form";
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
import { FilterPill } from "@/components/ui/filter-pill";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import {
  IDEA_NOTE_PRIORITIES,
  IDEA_NOTE_TYPES,
  MANUAL_IDEA_NOTE_STATUSES,
  getIdeaInboxNotes,
  getIdeaNoteProjectOptions,
  normalizeIdeaNoteListFilters,
  type IdeaNote,
  type IdeaNoteListView,
  type IdeaNoteProjectOption,
} from "@/lib/services/idea-note-service";
import { formatTaskToken } from "@/lib/task-domain";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Ideas",
  description: "Capture loose ideas before they become tasks.",
};

function formatIdeaAge(value: string) {
  const createdAt = new Date(value).getTime();
  if (Number.isNaN(createdAt)) {
    return "";
  }

  const minutes = Math.max(0, Math.round((Date.now() - createdAt) / 60_000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }

  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
    new Date(value),
  );
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
    title: "Inbox",
    description: "Newest active ideas and their current processing status.",
    emptyTitle: "No active ideas",
    emptyDescription: "Capture a thought, improvement, or opportunity and keep it separate from tasks until you are ready to process it.",
    countLabel: "inbox",
  };
}

function IdeaRow({
  note,
  projectOptions,
  isLast,
}: {
  note: IdeaNote;
  projectOptions: IdeaNoteProjectOption[];
  isLast: boolean;
}) {
  const isArchived = note.status === "archived";

  return (
    <li>
      <details className="group">
        <summary
          className="row cursor-pointer list-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--ega-text)]"
          style={isLast ? { borderBottom: 0 } : undefined}
        >
          <span className="row-main">
            <span className="row-title">{note.title}</span>
            <span className="row-meta">
              {formatTaskToken(note.type)}
              {" · "}
              {note.projects?.name ?? "No project"}
              {note.tags.length > 0 ? ` · ${note.tags.join(", ")}` : ""}
            </span>
          </span>
          {note.priority ? (
            <span className="hidden sm:inline-flex">
              <Badge tone="warn">{formatTaskToken(note.priority)}</Badge>
            </span>
          ) : null}
          <time
            dateTime={note.created_at}
            className="shrink-0 text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]"
          >
            {formatIdeaAge(note.created_at)}
          </time>
          <span className="row-actions">
            <span className="hidden sm:inline-flex">
              <span className="filter-pill">
                {isArchived ? "Restore" : "Convert"}
              </span>
            </span>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)] transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
          </span>
        </summary>

        <div className="flex flex-col gap-3 border-t border-[var(--ega-divider)] bg-[color:var(--ega-surface-subtle)] px-4 py-3">
          {note.body ? (
            <p className="max-w-[80ch] whitespace-pre-wrap text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
              {note.body}
            </p>
          ) : null}

          {isArchived ? (
            <IdeaNoteArchiveControls noteId={note.id} mode="restore" />
          ) : (
            <>
              <ConvertIdeaNoteForm note={note} projectOptions={projectOptions} />
              <EditIdeaNoteForm note={note} projectOptions={projectOptions} />
              <IdeaNoteArchiveControls noteId={note.id} mode="archive" />
            </>
          )}
        </div>
      </details>
    </li>
  );
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
      title="Ideas"
      description="Frictionless capture, triage, and conversion."
    >
      <div className="flex flex-col gap-6">
        <Card>
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

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Idea views">
              <FilterPill
                label="All"
                href={getIdeaViewHref("all", resolvedSearchParams)}
                active={activeView === "all"}
                ariaCurrent={activeView === "all" ? "page" : undefined}
              />
              <FilterPill
                label="Inbox"
                href={getIdeaViewHref("active", resolvedSearchParams)}
                active={activeView === "active"}
                ariaCurrent={activeView === "active" ? "page" : undefined}
              />
              <FilterPill
                label="Archived"
                href={getIdeaViewHref("archived", resolvedSearchParams)}
                active={activeView === "archived"}
                ariaCurrent={activeView === "archived" ? "page" : undefined}
              />
            </div>
            <Badge tone="muted">
              {notes.length} {copy.countLabel}
            </Badge>
          </div>

          <form action="/ideas" method="get" className="panel">
            <input type="hidden" name="view" value={activeView} />
            <div className="panel-body grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1.5fr)_repeat(5,minmax(120px,1fr))]">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="idea-filter-q" className="glass-label">
                  Search
                </label>
                <Input
                  id="idea-filter-q"
                  name="q"
                  defaultValue={filters.search}
                  placeholder="Title or body"
                  className="h-8 text-[length:var(--text-meta-lg)]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="idea-filter-type" className="glass-label">
                  Type
                </label>
                <select
                  id="idea-filter-type"
                  name="type"
                  defaultValue={filters.type}
                  className="input-instrument h-8 w-full px-2.5 text-[length:var(--text-meta-lg)]"
                >
                  <option value="all">All types</option>
                  {IDEA_NOTE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {formatTaskToken(type)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="idea-filter-status" className="glass-label">
                  Status
                </label>
                <select
                  id="idea-filter-status"
                  name="status"
                  defaultValue={filters.status}
                  className="input-instrument h-8 w-full px-2.5 text-[length:var(--text-meta-lg)]"
                >
                  <option value="all">All statuses</option>
                  {MANUAL_IDEA_NOTE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {formatTaskToken(status)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="idea-filter-project" className="glass-label">
                  Project
                </label>
                <select
                  id="idea-filter-project"
                  name="project"
                  defaultValue={filters.project}
                  className="input-instrument h-8 w-full px-2.5 text-[length:var(--text-meta-lg)]"
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

              <div className="flex flex-col gap-1.5">
                <label htmlFor="idea-filter-priority" className="glass-label">
                  Priority
                </label>
                <select
                  id="idea-filter-priority"
                  name="priority"
                  defaultValue={filters.priority}
                  className="input-instrument h-8 w-full px-2.5 text-[length:var(--text-meta-lg)]"
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

              <div className="flex flex-col gap-1.5">
                <label htmlFor="idea-filter-tag" className="glass-label">
                  Tag
                </label>
                <Input
                  id="idea-filter-tag"
                  name="tag"
                  defaultValue={filters.tag}
                  placeholder="ops"
                  className="h-8 text-[length:var(--text-meta-lg)]"
                />
              </div>
            </div>

            <div className="panel-footer">
              <div className="flex flex-wrap items-center gap-2">
                <PendingSubmitButton type="submit" size="sm" className="gap-2" pendingLabel="Applying…">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Apply filters
                </PendingSubmitButton>
                <Link
                  href="/ideas"
                  className={cn(buttonVariants({ variant: "muted", size: "sm" }))}
                >
                  Clear filters
                </Link>
              </div>
              {hasActiveFilters ? (
                <span className="inline-flex items-center gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                  <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                  {notes.length} matching {notes.length === 1 ? "idea" : "ideas"}
                </span>
              ) : null}
            </div>
          </form>

          <Card>
            {notes.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={hasActiveFilters ? "No ideas match these filters" : copy.emptyTitle}
                description={hasActiveFilters ? "Clear or adjust the filters to widen the inbox." : copy.emptyDescription}
              />
            ) : (
              <ul className="rows">
                {notes.map((note, index) => (
                  <IdeaRow
                    key={note.id}
                    note={note}
                    projectOptions={projectOptions}
                    isLast={index === notes.length - 1}
                  />
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
