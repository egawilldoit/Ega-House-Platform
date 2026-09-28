import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Inbox, Plus, Search } from "lucide-react";

import { BacklogArchiveControls } from "@/app/backlog/backlog-archive-controls";
import { BacklogConvertForm } from "@/app/backlog/backlog-convert-form";
import { BacklogItemForm } from "@/app/backlog/backlog-item-form";
import { AppShell } from "@/components/layout/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPill } from "@/components/ui/filter-pill";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import {
  getIdeaInboxNotes,
  getIdeaNoteProjectOptions,
  normalizeIdeaNoteListFilters,
  type IdeaNote,
  type IdeaNoteProjectOption,
} from "@/lib/services/idea-note-service";
import { INBOX_CAPTURE_EVENT } from "@/lib/workspace-events";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Backlog",
  description: "Keep ideas here until they are ready to become real work.",
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

type BacklogPageProps = {
  searchParams: Promise<{
    view?: string;
    q?: string;
    search?: string;
  }>;
};

const BACKLOG_VIEWS = ["active", "archived"] as const;

function normalizeBacklogView(value: string | undefined): (typeof BACKLOG_VIEWS)[number] {
  return BACKLOG_VIEWS.includes(value as (typeof BACKLOG_VIEWS)[number])
    ? (value as (typeof BACKLOG_VIEWS)[number])
    : "active";
}

function getBacklogViewHref(
  view: (typeof BACKLOG_VIEWS)[number],
  params: Awaited<BacklogPageProps["searchParams"]>,
) {
  const nextParams = new URLSearchParams();

  if (view !== "active") {
    nextParams.set("view", view);
  }

  const search = params.q ?? params.search;
  if (search?.trim()) {
    nextParams.set("q", search.trim());
  }

  const query = nextParams.toString();
  return query ? `/backlog?${query}` : "/backlog";
}

function getBacklogViewCopy(view: (typeof BACKLOG_VIEWS)[number]) {
  if (view === "archived") {
    return {
      title: "Archived",
      description: "Backlog items removed from active view but kept recoverable.",
      emptyTitle: "No archived items yet",
      emptyDescription: "Archived backlog items will appear here after you archive them.",
      countLabel: "archived",
    };
  }

  return {
    title: "Active",
    description: "Ideas and future work waiting to become real tasks.",
    emptyTitle: "No active backlog items",
    emptyDescription: "Capture a thought, improvement, or opportunity and keep it separate from tasks until you are ready to process it.",
    countLabel: "items",
  };
}

function BacklogRow({
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
              {note.projects?.name ?? "No project"}
            </span>
          </span>
          <time
            dateTime={note.created_at}
            className="shrink-0 text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]"
          >
            {formatIdeaAge(note.created_at)}
          </time>
          <span className="row-actions">
            <span className="hidden sm:inline-flex">
              <span className="filter-pill">
                {isArchived ? "Restore" : "Turn into Task"}
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
            <BacklogArchiveControls noteId={note.id} mode="restore" />
          ) : (
            <>
              <BacklogConvertForm note={note} projectOptions={projectOptions} />
              <BacklogItemForm note={note} projectOptions={projectOptions} />
              <BacklogArchiveControls noteId={note.id} mode="archive" />
            </>
          )}
        </div>
      </details>
    </li>
  );
}

export default async function BacklogPage({ searchParams }: BacklogPageProps) {
  const resolvedSearchParams = await searchParams;
  const activeView = normalizeBacklogView(resolvedSearchParams.view);
  const filters = normalizeIdeaNoteListFilters({
    view: activeView,
    search: resolvedSearchParams.q ?? resolvedSearchParams.search,
  });
  const hasSearch = Boolean(filters.search);
  const copy = getBacklogViewCopy(activeView);
  const [notes, projectOptions] = await Promise.all([
    getIdeaInboxNotes({ filters }),
    getIdeaNoteProjectOptions(),
  ]);

  return (
    <AppShell
      title="Backlog"
      description="Keep ideas here until they are ready to become real work."
      actions={
        <button
          type="button"
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-2")}
          onClick={() => window.dispatchEvent(new CustomEvent(INBOX_CAPTURE_EVENT))}
          data-testid="backlog-add-item"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add to Backlog
        </button>
      }
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Backlog views">
              <FilterPill
                label="Active"
                href={getBacklogViewHref("active", resolvedSearchParams)}
                active={activeView === "active"}
                ariaCurrent={activeView === "active" ? "page" : undefined}
              />
              <FilterPill
                label="Archived"
                href={getBacklogViewHref("archived", resolvedSearchParams)}
                active={activeView === "archived"}
                ariaCurrent={activeView === "archived" ? "page" : undefined}
              />
            </div>
          </div>

          <form action="/backlog" method="get" className="panel">
            <input type="hidden" name="view" value={activeView} />
            <div className="panel-body flex flex-wrap items-end gap-3">
              <div className="flex min-w-52 flex-1 flex-col gap-1.5">
                <label htmlFor="backlog-filter-q" className="form-label">
                  Search
                </label>
                <Input
                  id="backlog-filter-q"
                  name="q"
                  defaultValue={filters.search}
                  placeholder="Title or notes"
                  className="h-8 text-[length:var(--text-meta-lg)]"
                />
              </div>
            </div>
            <div className="panel-footer">
              <div className="flex flex-wrap items-center gap-2">
                <PendingSubmitButton type="submit" size="sm" className="gap-2" pendingLabel="Searching…">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Search
                </PendingSubmitButton>
                <Link
                  href="/backlog"
                  className={cn(buttonVariants({ variant: "muted", size: "sm" }))}
                >
                  Clear
                </Link>
              </div>
            </div>
          </form>

          <Card>
            {notes.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={hasSearch ? "No items match your search" : copy.emptyTitle}
                description={hasSearch ? "Try a different search term." : copy.emptyDescription}
              />
            ) : (
              <ul className="rows">
                {notes.map((note, index) => (
                  <BacklogRow
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
