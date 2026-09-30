import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Flame,
  Folder,
  ListChecks,
  Play,
} from "lucide-react";
import { Suspense } from "react";

import { completeTodayTaskAction } from "@/app/today/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { LiveDuration } from "@/components/timer/live-duration";
import { getTaskContextHref } from "@/lib/task-navigation";
import {
  formatDisplayDate,
  formatDisplayEstimate,
} from "@/lib/presentation-format";
import { formatTaskToken } from "@/lib/task-domain";

import type { HomeGreeting } from "../_lib/home-greeting";
import type { HomeModel } from "../_lib/home-page-model";
import { ActivityPulseSection, ActivityPulseSkeleton } from "./activity-pulse-section";
import { HomeQuickActions } from "./home-quick-actions";

type HomeTask = NonNullable<HomeModel["startHere"]>;

/* ── Greeting ───────────────────────────────────────────────────────────── */

function HomeHeader({ greeting, name }: { greeting: HomeGreeting | null; name: string }) {
  return (
    <header className="flex flex-col gap-1.5">
      {greeting?.dateLine ? <p className="glass-label">{greeting.dateLine}</p> : null}
      <h1
        tabIndex={-1}
        data-shell-page-title
        className="text-3xl font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)] md:text-4xl"
      >
        {greeting?.greeting ?? `Welcome back, ${name}`}
      </h1>
      {greeting ? (
        <p className="text-[length:var(--text-body)] text-[color:var(--ega-text-secondary)]">
          {greeting.fullDateLine} · {greeting.subtitle}
        </p>
      ) : null}
    </header>
  );
}

/* ── Now (dominant) ──────────────────────────────────────────────────────── */

/** Soft green mountain scene for the running-focus state (decorative). */
function NowCardIllustration() {
  return (
    <svg
      viewBox="0 0 420 220"
      preserveAspectRatio="xMidYMax slice"
      className="h-full w-full"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="330" cy="52" r="26" fill="#fde68a" opacity="0.85" />
      <circle cx="330" cy="52" r="40" fill="#fde68a" opacity="0.25" />
      <path
        d="M-20 220 L120 78 L210 170 L300 60 L440 220 Z"
        fill="color-mix(in srgb, var(--status-healthy) 12%, var(--ega-surface))"
      />
      <path
        d="M40 220 L180 96 L280 200 L360 120 L460 220 Z"
        fill="color-mix(in srgb, var(--status-healthy) 20%, var(--ega-surface))"
      />
      <path
        d="M-40 220 L60 150 L150 220 Z M220 220 L330 140 L460 220 Z"
        fill="color-mix(in srgb, var(--status-healthy) 30%, var(--ega-surface))"
      />
      <g fill="color-mix(in srgb, var(--status-healthy) 38%, var(--ega-surface))">
        <path d="M96 132 l10 -22 l10 22 Z" />
        <path d="M120 140 l8 -18 l8 18 Z" />
        <path d="M300 150 l10 -22 l10 22 Z" />
      </g>
    </svg>
  );
}

function TaskContextLine({ task }: { task: HomeTask }) {
  return (
    <p className="flex items-center gap-1.5 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
      <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {task.projectName}
        {task.goalTitle ? ` · ${task.goalTitle}` : ""}
      </span>
    </p>
  );
}

function TaskMetaBadges({ task }: { task: HomeTask }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={task.status} />
      {task.priority === "high" || task.priority === "urgent" ? (
        <Badge tone="warn">{formatTaskToken(task.priority)}</Badge>
      ) : null}
      {task.estimateMinutes ? (
        <Badge tone="muted">{formatDisplayEstimate(task.estimateMinutes)}</Badge>
      ) : null}
    </div>
  );
}

function OpenTimerButton({ testId }: { testId?: string }) {
  return (
    <Link
      href="/timer"
      className="btn-instrument flex h-10 items-center gap-2 px-4 text-sm"
      data-testid={testId}
    >
      <Play className="h-3.5 w-3.5" aria-hidden="true" />
      Open timer
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

function ViewTaskButton({ task }: { task: HomeTask | null }) {
  return (
    <Link
      href={getTaskContextHref(task?.id ?? "", task?.projectSlug ?? null)}
      className="btn-instrument btn-instrument-muted flex h-10 items-center gap-2 px-4 text-sm"
    >
      View task
    </Link>
  );
}

/**
 * The visually strongest Home block: the running Timer replaces Start Here.
 * Home never computes Timer duration — LiveDuration owns the isolated tick.
 */
function NowPanel({ model }: { model: HomeModel }) {
  const activeTimer = model.activeTimer;

  if (activeTimer) {
    const task = activeTimer.task;
    return (
      <Card
        level="hero"
        data-testid="home-active-timer"
        data-task-id={activeTimer.taskId}
        className="relative overflow-hidden border-[var(--status-healthy-border)] bg-[linear-gradient(115deg,var(--status-healthy-bg)_0%,var(--ega-surface)_58%)]"
      >
        <CardContent className="relative flex flex-col gap-4 pr-0 md:pr-[30%]">
          <p className="glass-label inline-flex items-center gap-1.5 text-[color:var(--status-healthy)]">
            <span
              className="h-1.5 w-1.5 rounded-full bg-[color:var(--status-healthy)]"
              aria-hidden="true"
            />
            Focus running
          </p>
          <div>
            <h3 className="max-w-[60ch] text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]">
              {task?.title ?? "Timer active"}
            </h3>
            {task ? (
              <div className="mt-1.5">
                <TaskContextLine task={task} />
              </div>
            ) : null}
          </div>
          {activeTimer.startedAt ? (
            <LiveDuration startedAt={activeTimer.startedAt} className="tabular-nums" />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <OpenTimerButton />
            <ViewTaskButton task={task} />
          </div>
        </CardContent>
        <div className="pointer-events-none absolute bottom-0 right-0 hidden h-full w-[34%] max-w-105 md:block">
          <NowCardIllustration />
        </div>
      </Card>
    );
  }

  const task = model.startHere;

  if (!task) {
    return (
      <Card level="hero" data-testid="home-start-here-empty">
        <CardContent className="flex flex-col gap-2 py-6">
          <p className="glass-label">Start here</p>
          <h3 className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]">
            Nothing queued right now
          </h3>
          <p className="max-w-[60ch] text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
            Capture a thought or create a task and Home will have a first move for you.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card level="hero" data-testid="home-start-here" data-task-id={task.id}>
      <CardContent className="flex flex-col gap-4">
        <p className="glass-label">Start here</p>
        <div>
          <h3 className="max-w-[60ch] text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]">
            {task.title}
          </h3>
          <div className="mt-1.5">
            <TaskContextLine task={task} />
          </div>
        </div>
        {task.description ? (
          <p className="line-clamp-2 max-w-[70ch] text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
            {task.description}
          </p>
        ) : null}
        <TaskMetaBadges task={task} />
        <div className="flex flex-wrap items-center gap-2">
          <OpenTimerButton testId="home-open-timer" />
          <form action={completeTodayTaskAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="returnTo" value="/home" />
            <PendingSubmitButton
              type="submit"
              size="md"
              variant="secondary"
              pendingLabel="Saving..."
            >
              Done
            </PendingSubmitButton>
          </form>
          <ViewTaskButton task={task} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Today (compact progress + focus list) ──────────────────────────────── */

function TodayPanel({ model }: { model: HomeModel }) {
  const progress = model.todayProgress;
  const tasks = model.todayTasks ?? [];

  return (
    <Card
      title="Today"
      data-testid="home-today"
      action={
        progress && progress.totalCount > 0 ? (
          <Link
            href="/today"
            className="inline-flex max-w-[60%] items-center gap-1 text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]"
            aria-label={`Open Today — ${progress.completedCount} of ${progress.totalCount} complete${
              progress.totalEstimateMinutes > 0
                ? `, ${formatDisplayEstimate(progress.totalEstimateMinutes)} planned`
                : ""
            }`}
          >
            <span className="truncate">
              {progress.completedCount} of {progress.totalCount} complete
              {progress.totalEstimateMinutes > 0
                ? ` · ${formatDisplayEstimate(progress.totalEstimateMinutes)} planned`
                : ""}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </Link>
        ) : undefined
      }
    >
      {progress === null ? (
        <CardContent>
          <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
            Today&rsquo;s plan is unavailable right now.
          </p>
        </CardContent>
      ) : progress.ratio === null ? (
        <CardContent className="flex flex-col gap-3">
          <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
            Nothing is planned for today yet.
          </p>
          <Link
            href="/today"
            className="text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] underline-offset-4 hover:text-[color:var(--ega-text)] hover:underline"
          >
            Plan today
          </Link>
        </CardContent>
      ) : (
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <ProgressBar
              value={progress.ratio}
              max={100}
              size="md"
              label="Today's progress"
              valueText={`${progress.ratio}% of today's planned work completed`}
              className="flex-1"
            />
            <span className="w-10 shrink-0 text-right text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]">
              {progress.ratio}%
            </span>
          </div>
          <div className="flex items-start gap-8">
            <div>
              <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                Planned today
              </p>
              <p className="tabular-nums text-[length:var(--text-body-lg)] font-semibold text-[color:var(--ega-text)]">
                {progress.plannedCount}
              </p>
            </div>
            <div>
              <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                In progress today
              </p>
              <p className="tabular-nums text-[length:var(--text-body-lg)] font-semibold text-[color:var(--ega-text)]">
                {progress.inProgressCount}
              </p>
            </div>
          </div>

          {tasks.length > 0 ? (
            <div className="flex flex-col gap-1 border-t border-[var(--ega-border)] pt-3">
              <p className="text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text-secondary)]">
                Today&apos;s Focus
              </p>
              {tasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <form action={completeTodayTaskAction} className="shrink-0">
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="returnTo" value="/home" />
                      <button
                        type="submit"
                        className="h-4 w-4 rounded border border-[var(--ega-border-strong)] hover:bg-[var(--status-healthy-bg)] hover:border-[var(--status-healthy)] transition-colors"
                        title="Complete task"
                        aria-label={`Complete ${task.title}`}
                      />
                    </form>
                    <Link
                      href={getTaskContextHref(task.id, task.projectSlug)}
                      className="truncate font-medium text-[color:var(--ega-text)] hover:underline"
                    >
                      {task.title}
                    </Link>
                    <span className="shrink-0 text-xs text-[color:var(--ega-text-tertiary)]">
                      · {task.projectName}
                    </span>
                  </div>
                  {task.estimateMinutes ? (
                    <span className="shrink-0 text-xs tabular-nums text-[color:var(--ega-text-tertiary)]">
                      {formatDisplayEstimate(task.estimateMinutes)}
                    </span>
                  ) : null}
                </div>
              ))}
              <Link
                href="/today"
                className="mt-1 inline-flex items-center gap-1 text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]"
              >
                View all in Today
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}

/* ── Next Up (at most one task) ─────────────────────────────────────────── */

function NextPanel({ model }: { model: HomeModel }) {
  const next = model.nextUp;

  return (
    <Card
      title="Next"
      data-testid="home-next"
      action={
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]"
        >
          View all
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      }
    >
      {next ? (
        <CardContent>
          <Link
            href={getTaskContextHref(next.id, next.projectSlug)}
            className="row row-link"
            data-task-id={next.id}
          >
            <span
              className="h-4 w-4 shrink-0 rounded-full border-2 border-[color:var(--ega-border-strong)]"
              aria-hidden="true"
            />
            <span className="row-main">
              <span className="row-title">{next.title}</span>
              <span className="row-meta">
                {next.projectName}
                {next.dueDate ? ` · Due ${formatDisplayDate(next.dueDate, "compact")}` : ""}
              </span>
            </span>
          </Link>
        </CardContent>
      ) : (
        <CardContent>
          <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
            Nothing next &mdash; Today holds the full queue.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

/* ── Needs attention ────────────────────────────────────────────────────── */

function AttentionRow({
  href,
  icon,
  label,
  count,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  tone: "overdue" | "risk" | "neutral";
}) {
  const toneClass =
    tone === "overdue"
      ? "text-[color:var(--status-overdue)]"
      : tone === "risk"
        ? "text-[color:var(--status-risk)]"
        : "text-[color:var(--ega-text-secondary)]";

  return (
    <Link href={href} className="row row-link">
      {icon}
      <span className="row-main">
        <span className="row-title">{label}</span>
      </span>
      {typeof count === "number" ? (
        <span className={`tabular-nums text-[length:var(--text-meta-lg)] font-medium ${toneClass}`}>
          {count}
        </span>
      ) : (
        <ChevronRight className={`h-4 w-4 shrink-0 ${toneClass}`} aria-hidden="true" />
      )}
    </Link>
  );
}

function AttentionPanel({ model }: { model: HomeModel }) {
  const attention = model.attention;

  return (
    <Card
      title="Needs attention"
      data-testid="home-attention"
    >
      <CardContent className="flex flex-col gap-1">
        {attention === null ? (
          <p className="flex items-center gap-2 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
            <CircleAlert className="h-4 w-4 shrink-0 text-[color:var(--status-risk)]" aria-hidden="true" />
            Attention status unavailable.
          </p>
        ) : (
          <>
            {attention.overdue > 0 ? (
              <AttentionRow
                href="/tasks?due=overdue"
                tone="overdue"
                label="Overdue"
                count={attention.overdue}
                icon={
                  <CircleAlert
                    className="h-4 w-4 shrink-0 text-[color:var(--status-overdue)]"
                    aria-hidden="true"
                  />
                }
              />
            ) : null}
            {attention.dueToday > 0 ? (
              <AttentionRow
                href="/tasks?due=due_today"
                tone="risk"
                label="Due today"
                count={attention.dueToday}
                icon={
                  <CalendarCheck2
                    className="h-4 w-4 shrink-0 text-[color:var(--status-risk)]"
                    aria-hidden="true"
                  />
                }
              />
            ) : null}
            {attention.reviewMissing ? (
              <AttentionRow
                href="/review"
                tone="risk"
                label="Weekly review due"
                icon={
                  <ListChecks
                    className="h-4 w-4 shrink-0 text-[color:var(--status-risk)]"
                    aria-hidden="true"
                  />
                }
              />
            ) : null}
            {attention.overdue === 0 && attention.dueToday === 0 && !attention.reviewMissing ? (
              <p className="flex items-center gap-2 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
                <CheckCircle2
                  className="h-4 w-4 text-[color:var(--status-healthy)]"
                  aria-hidden="true"
                />
                You&rsquo;re clear right now.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Degraded states ────────────────────────────────────────────────────── */

function DegradedNotice() {
  return (
    <div className="feedback-block feedback-block-warn" data-testid="home-degraded" role="status">
      <Flame className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>Suggested work and today&rsquo;s counts are unavailable right now. Quick actions still work.</p>
    </div>
  );
}

/* ── Page Layout ────────────────────────────────────────────────────────── */

export function AuthenticatedHomePage({
  model,
  greeting,
  name,
}: {
  model: HomeModel;
  greeting: HomeGreeting | null;
  name: string;
}) {
  return (
    <div className="flex flex-col gap-6" data-testid="home-workspace">
      {model.availability.operator === "unavailable" ? <DegradedNotice /> : null}

      <HomeHeader greeting={greeting} name={name} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* Left/Main Column: 8 cols (~67%) */}
        <div className="flex flex-col gap-6 lg:col-span-8">
          <NowPanel model={model} />
          <HomeQuickActions />
          <TodayPanel model={model} />
          <NextPanel model={model} />
        </div>

        {/* Right/Rail Column: 4 cols (~33%) */}
        <div className="flex flex-col gap-6 lg:col-span-4">
          <AttentionPanel model={model} />
          <Suspense fallback={<ActivityPulseSkeleton />}>
            <ActivityPulseSection />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
