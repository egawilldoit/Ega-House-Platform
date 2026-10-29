import type {
  ArchiveGoalRecord,
  ArchiveProjectRecord,
  ArchiveTaskRecord,
} from "@ega/application";
import type { ArchiveTab } from "@ega/domain";
import { Archive, FolderArchive, Goal, ListChecks, Search } from "lucide-react";
import Link from "next/link";

import { restoreArchivedEntityAction } from "@/app/archive/actions";
import type { ArchivePageModel } from "@/app/archive/_lib/archive-page-model";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPill } from "@/components/ui/filter-pill";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { buttonVariants } from "@/components/ui/button";
import { formatDisplayDate } from "@/lib/presentation-format";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";
import { cn } from "@/lib/utils";

const ARCHIVE_TABS: ReadonlyArray<{
  tab: ArchiveTab;
  label: string;
  icon: typeof ListChecks;
  searchPlaceholder: string;
}> = [
  {
    tab: "tasks",
    label: "Tasks",
    icon: ListChecks,
    searchPlaceholder: "Task title",
  },
  { tab: "goals", label: "Goals", icon: Goal, searchPlaceholder: "Goal title" },
  {
    tab: "projects",
    label: "Projects",
    icon: FolderArchive,
    searchPlaceholder: "Project name",
  },
];

export function getArchiveHref(tab: ArchiveTab, search: string) {
  const params = new URLSearchParams();
  if (tab !== "tasks") params.set("tab", tab);
  if (search) params.set("q", search);
  const query = params.toString();
  return query ? `/archive?${query}` : "/archive";
}

function formatArchivedAt(archivedAt: string) {
  return `Archived ${formatDisplayDate(archivedAt, "detail")}`;
}

function RestoreForm({
  entity,
  id,
  itemTitle,
  returnTo,
}: {
  entity: ArchiveTab;
  id: string;
  itemTitle: string;
  returnTo: string;
}) {
  return (
    <form action={restoreArchivedEntityAction}>
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <PendingSubmitButton
        type="submit"
        variant="secondary"
        size="sm"
        pendingLabel="Restoring…"
        aria-label={`Restore ${itemTitle}`}
      >
        Restore
      </PendingSubmitButton>
    </form>
  );
}

function ParentArchivedNote({ parent }: { parent: string }) {
  return (
    <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
      Stays hidden from active lists until its {parent} is restored.
    </span>
  );
}

function ArchiveRow({
  entity,
  id,
  title,
  meta,
  statusLabel,
  statusTone,
  archivedAt,
  returnTo,
  parentArchived,
}: {
  entity: ArchiveTab;
  id: string;
  title: string;
  meta: string | null;
  statusLabel: string | null;
  statusTone: Parameters<typeof Badge>[0]["tone"];
  archivedAt: string;
  returnTo: string;
  parentArchived?: "project" | "goal" | null;
}) {
  return (
    <li id={`archive-${entity}-${id}`} className="row scroll-mt-24">
      <span className="row-main">
        <span className="row-title">{title}</span>
        {meta ? <span className="row-meta">{meta}</span> : null}
        {parentArchived ? <ParentArchivedNote parent={parentArchived} /> : null}
      </span>

      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        {statusLabel ? <Badge tone={statusTone}>{statusLabel}</Badge> : null}
        <Badge tone="warn">Archived</Badge>
      </span>

      <time
        dateTime={archivedAt}
        className="shrink-0 whitespace-nowrap text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]"
      >
        {formatArchivedAt(archivedAt)}
      </time>

      <span className="row-actions">
        <RestoreForm
          entity={entity}
          id={id}
          itemTitle={title}
          returnTo={returnTo}
        />
      </span>
    </li>
  );
}

function TaskRows({
  tasks,
  returnTo,
}: {
  tasks: ArchiveTaskRecord[];
  returnTo: string;
}) {
  return (
    <>
      {tasks.map((task) => (
        <ArchiveRow
          key={task.id}
          entity="tasks"
          id={task.id}
          title={task.title}
          meta={[
            task.projectName ?? "No project",
            task.goalTitle ? `Goal: ${task.goalTitle}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          statusLabel={formatTaskToken(task.status)}
          statusTone={getTaskStatusTone(task.status)}
          archivedAt={task.archivedAt}
          returnTo={returnTo}
          parentArchived={
            task.projectArchived ? "project" : task.goalArchived ? "goal" : null
          }
        />
      ))}
    </>
  );
}

function GoalRows({
  goals,
  returnTo,
}: {
  goals: ArchiveGoalRecord[];
  returnTo: string;
}) {
  return (
    <>
      {goals.map((goal) => (
        <ArchiveRow
          key={goal.id}
          entity="goals"
          id={goal.id}
          title={goal.title}
          meta={goal.projectName ?? "No project"}
          statusLabel={null}
          statusTone="muted"
          archivedAt={goal.archivedAt}
          returnTo={returnTo}
          parentArchived={goal.projectArchived ? "project" : null}
        />
      ))}
    </>
  );
}

function ProjectRows({
  projects,
  returnTo,
}: {
  projects: ArchiveProjectRecord[];
  returnTo: string;
}) {
  return (
    <>
      {projects.map((project) => (
        <ArchiveRow
          key={project.id}
          entity="projects"
          id={project.id}
          title={project.name}
          meta={project.slug}
          statusLabel={null}
          statusTone="muted"
          archivedAt={project.archivedAt}
          returnTo={returnTo}
        />
      ))}
    </>
  );
}

const EMPTY_COPY: Record<
  ArchiveTab,
  { title: string; description: string; searchDescription: string }
> = {
  tasks: {
    title: "No archived tasks",
    description:
      "Tasks you archive from the task list appear here so you can restore them later.",
    searchDescription:
      "No archived task matches this search. Try a different title.",
  },
  goals: {
    title: "No archived goals",
    description:
      "Archived goals stay available for reference until you restore them.",
    searchDescription:
      "No archived goal matches this search. Try a different title.",
  },
  projects: {
    title: "No archived projects",
    description:
      "Archived projects stay available for reference until you restore them.",
    searchDescription:
      "No archived project matches this search. Try a different name.",
  },
};

export function ArchivePageView({ model }: { model: ArchivePageModel }) {
  const activeTab =
    ARCHIVE_TABS.find((entry) => entry.tab === model.tab) ?? ARCHIVE_TABS[0];
  const returnTo = getArchiveHref(model.tab, model.search);
  const counts: Record<ArchiveTab, number> = {
    tasks: model.summary.tasks,
    goals: model.summary.goals,
    projects: model.summary.projects,
  };
  const itemCount =
    model.tab === "tasks"
      ? model.tasks.length
      : model.tab === "goals"
        ? model.goals.length
        : model.projects.length;
  const emptyCopy = EMPTY_COPY[model.tab];
  const Icon = activeTab.icon;

  return (
    <div className="flex flex-col gap-6">
      {model.errorMessage ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {model.errorMessage}
        </p>
      ) : null}
      {model.notice ? (
        <p role="status" className="feedback-block">
          {model.notice}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Archive sections"
          >
            {ARCHIVE_TABS.map((entry) => (
              <FilterPill
                key={entry.tab}
                label={`${entry.label} (${counts[entry.tab]})`}
                href={getArchiveHref(entry.tab, model.search)}
                active={model.tab === entry.tab}
                ariaCurrent={model.tab === entry.tab ? "page" : undefined}
              />
            ))}
          </div>
          <p className="text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]">
            {itemCount === 1 ? "1 item" : `${itemCount} items`}
            {model.search ? " matching this search" : " in this section"}
          </p>
        </div>

        <form action="/archive" method="get" className="panel">
          {model.tab !== "tasks" ? (
            <input type="hidden" name="tab" value={model.tab} />
          ) : null}
          <div className="panel-body flex flex-wrap items-end gap-3">
            <div className="flex min-w-52 flex-1 flex-col gap-1.5">
              <label htmlFor="archive-search" className="form-label">
                Search {activeTab.label.toLowerCase()}
              </label>
              <Input
                id="archive-search"
                name="q"
                type="search"
                defaultValue={model.search}
                placeholder={activeTab.searchPlaceholder}
                className="h-8 text-[length:var(--text-meta-lg)]"
              />
            </div>
          </div>
          <div className="panel-footer">
            <div className="flex flex-wrap items-center gap-2">
              <PendingSubmitButton
                type="submit"
                size="sm"
                className="gap-2"
                pendingLabel="Searching…"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                Search
              </PendingSubmitButton>
              <Link
                href={getArchiveHref(model.tab, "")}
                className={cn(buttonVariants({ variant: "muted", size: "sm" }))}
              >
                Clear
              </Link>
            </div>
          </div>
        </form>

        <Card>
          {itemCount === 0 ? (
            <EmptyState
              icon={Icon}
              title={
                model.search ? "No matches in the archive" : emptyCopy.title
              }
              description={
                model.search
                  ? emptyCopy.searchDescription
                  : emptyCopy.description
              }
              actionLabel={model.search ? "Clear search" : undefined}
              actionHref={
                model.search ? getArchiveHref(model.tab, "") : undefined
              }
            />
          ) : (
            <ul className="rows">
              {model.tab === "tasks" ? (
                <TaskRows tasks={model.tasks} returnTo={returnTo} />
              ) : model.tab === "goals" ? (
                <GoalRows goals={model.goals} returnTo={returnTo} />
              ) : (
                <ProjectRows projects={model.projects} returnTo={returnTo} />
              )}
            </ul>
          )}
        </Card>

        <p className="flex items-start gap-2 text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-[color:var(--ega-text-tertiary)]">
          <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Restoring never changes archived children or past sessions.
            Permanent deletion is not available in the archive centre: it needs
            the owner&apos;s approved retention and cascade policy first.
          </span>
        </p>
      </section>
    </div>
  );
}
