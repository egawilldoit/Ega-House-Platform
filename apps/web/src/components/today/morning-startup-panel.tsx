import Link from "next/link";
import { CalendarClock, ListChecks, SkipForward } from "lucide-react";

import { startMorningOutcomesAction } from "@/app/(workspace)/today/startup-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import type { MorningStartupModel } from "@/lib/morning-startup";
import { formatTaskEstimate } from "@/lib/task-estimate";

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

/**
 * Concise after-Fajr startup flow inside the existing Today page.
 *
 * Exactly one primary project is chosen by submitting one project's form; the
 * server derives the single project from the validated task rows. Creating a
 * new task is intentionally not offered here; the link points at Tasks so this
 * flow cannot become a second task-creation surface.
 */
export function MorningStartupPanel({
  model,
  returnTo = "/today",
}: {
  model: MorningStartupModel;
  returnTo?: string;
}) {
  if (model.skipped) {
    return (
      <Card
        label="Morning startup"
        title="Startup skipped"
        data-testid="morning-startup-skipped"
      >
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
            You skipped the morning startup for {model.date}. Today still works as usual.
          </p>
          <Link
            href="/today"
            data-testid="morning-startup-resume"
            className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
          >
            Resume startup
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      label="Morning startup"
      title="Start your day"
      action={
        <Badge tone={model.isRestDay ? "muted" : "info"}>{model.workTargetLabel}</Badge>
      }
      data-testid="morning-startup"
    >
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          {model.isRestDay ? (
            <p
              data-testid="morning-startup-target"
              className="text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]"
            >
              Rest day: no work target is configured for {model.weekday}.
            </p>
          ) : (
            <p
              data-testid="morning-startup-target"
              className="text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]"
            >
              Today&apos;s work target:{" "}
              <span className="font-semibold">{model.workTargetLabel}</span>
            </p>
          )}
          {model.paused ? (
            <p
              data-testid="morning-startup-paused"
              className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]"
            >
              Personal schedule is paused; the target above is informational.
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <section aria-labelledby="morning-startup-yesterday-heading" className="flex flex-col gap-1.5">
            <h4
              id="morning-startup-yesterday-heading"
              className="text-[length:var(--text-micro)] font-semibold uppercase tracking-[var(--tracking-widest)] text-[color:var(--ega-text-tertiary)]"
            >
              Yesterday
            </h4>
            {model.yesterday.errorMessage ? (
              <p
                role="status"
                data-testid="morning-startup-yesterday-error"
                className="text-[length:var(--text-meta-lg)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]"
              >
                {model.yesterday.errorMessage}
              </p>
            ) : (
              <>
                <p
                  data-testid="morning-startup-yesterday-count"
                  className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]"
                >
                  {model.yesterday.completedCount}{" "}
                  {pluralize(model.yesterday.completedCount, "task", "tasks")} completed
                </p>
                {model.yesterday.tasks.length > 0 ? (
                  <ul
                    data-testid="morning-startup-yesterday"
                    className="flex flex-col gap-1"
                  >
                    {model.yesterday.tasks.map((task) => (
                      <li
                        key={task.id}
                        className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]"
                      >
                        {task.title}
                        {task.projectName ? (
                          <span className="text-[color:var(--ega-text-tertiary)]">
                            {" "}
                            · {task.projectName}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
                    No completed work recorded yesterday.
                  </p>
                )}
              </>
            )}
          </section>

          <section aria-labelledby="morning-startup-carryover-heading" className="flex flex-col gap-1.5">
            <h4
              id="morning-startup-carryover-heading"
              className="text-[length:var(--text-micro)] font-semibold uppercase tracking-[var(--tracking-widest)] text-[color:var(--ega-text-tertiary)]"
            >
              Carryovers
            </h4>
            <p
              data-testid="morning-startup-carryover-count"
              className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]"
            >
              {model.carryovers.count}{" "}
              {pluralize(model.carryovers.count, "task", "tasks")} carried into today
            </p>
            {model.carryovers.tasks.length > 0 ? (
              <ul data-testid="morning-startup-carryovers" className="flex flex-col gap-1">
                {model.carryovers.tasks.map((task) => (
                  <li
                    key={task.id}
                    className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]"
                  >
                    {task.title}
                    <span className="text-[color:var(--ega-text-tertiary)]">
                      {" "}
                      · {task.projectName}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
                Nothing is carrying over right now.
              </p>
            )}
          </section>
        </div>

        {model.selectedOutcomes.length > 0 ? (
          <section
            aria-labelledby="morning-startup-planned-heading"
            data-testid="morning-startup-planned"
            className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-[var(--ega-divider)] bg-[color:var(--ega-surface-subtle)] px-3 py-2.5"
          >
            <h4
              id="morning-startup-planned-heading"
              className="text-[length:var(--text-micro)] font-semibold uppercase tracking-[var(--tracking-widest)] text-[color:var(--ega-text-tertiary)]"
            >
              Planned for today ({model.selectedOutcomes.length})
            </h4>
            <ul className="flex flex-col gap-1">
              {model.selectedOutcomes.map((task) => (
                <li
                  key={task.id}
                  className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]"
                >
                  {task.title}
                  <span className="text-[color:var(--ega-text-tertiary)]">
                    {" "}
                    · {task.projectName}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section
          aria-labelledby="morning-startup-outcomes-heading"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4
              id="morning-startup-outcomes-heading"
              className="flex items-center gap-2 text-[length:var(--text-panel-title)] font-semibold text-[color:var(--ega-text)]"
            >
              <CalendarClock
                className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]"
                aria-hidden="true"
              />
              Choose 1–3 outcomes
            </h4>
            <Link
              href="/today?startup=skipped"
              data-testid="morning-startup-skip"
              className="btn-instrument btn-instrument-muted flex h-8 items-center gap-1.5 px-3 text-sm"
            >
              <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
              Skip for now
            </Link>
          </div>

          <p
            id="morning-startup-outcomes-help"
            className="text-[length:var(--text-meta-lg)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]"
          >
            Pick one project and 1 to 3 outcome tasks. The first project you submit becomes the
            primary focus for today.
          </p>

          {model.groups.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No outcome tasks ready"
              description="Create or unblock work in Tasks, then return to start your day."
              action={
                <Link
                  href="/tasks"
                  className="btn-instrument flex h-8 items-center px-3 text-sm"
                >
                  Open Tasks
                </Link>
              }
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {model.groups.map((group, groupIndex) => {
                const helpId = `morning-startup-group-${groupIndex}-help`;
                return (
                  <form
                    key={group.key}
                    action={startMorningOutcomesAction}
                    data-testid={`morning-startup-group-${groupIndex}`}
                    className="rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)] p-3"
                  >
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <fieldset className="flex flex-col gap-2" aria-describedby={helpId}>
                      <legend className="flex flex-wrap items-center gap-2 text-[length:var(--text-body)] font-semibold text-[color:var(--ega-text)]">
                        {group.projectName}
                        {group.isPrimary ? <Badge tone="info">Primary</Badge> : null}
                      </legend>
                      <p
                        id={helpId}
                        className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]"
                      >
                        Choose 1 to 3 tasks from this project.
                      </p>
                      <ul className="flex flex-col gap-1.5">
                        {group.tasks.map((task) => {
                          const inputId = `morning-startup-task-${task.id}`;
                          return (
                            <li key={task.id}>
                              <div className="flex items-start gap-2">
                                <input
                                  id={inputId}
                                  type="checkbox"
                                  name="taskIds"
                                  value={task.id}
                                  aria-describedby={helpId}
                                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ega-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-accent)]"
                                />
                                <label
                                  htmlFor={inputId}
                                  className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-[color:var(--ega-text)]"
                                >
                                  {task.title}
                                  {task.estimateMinutes ? (
                                    <span className="text-[color:var(--ega-text-tertiary)]">
                                      {" "}
                                      · {formatTaskEstimate(task.estimateMinutes)}
                                    </span>
                                  ) : null}
                                </label>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                      <PendingSubmitButton
                        type="submit"
                        size="sm"
                        variant={group.isPrimary ? "primary" : "secondary"}
                        pendingLabel="Starting..."
                        className="mt-1 w-fit"
                      >
                        Start with {group.projectName}
                      </PendingSubmitButton>
                    </fieldset>
                  </form>
                );
              })}
            </div>
          )}

          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Need new work?{" "}
            <Link
              href="/tasks"
              className="underline decoration-[var(--ega-border-strong)] underline-offset-2 hover:text-[color:var(--ega-text)]"
            >
              Create a task in Tasks
            </Link>
            . This startup flow only selects existing work.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
