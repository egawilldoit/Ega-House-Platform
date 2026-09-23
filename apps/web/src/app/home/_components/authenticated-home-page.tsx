import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Flame,
  ListChecks,
  Timer,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { LiveDuration } from "@/components/timer/live-duration";
import {
  formatDisplayDate,
  formatDisplayEstimate,
  formatDisplayPercent,
} from "@/lib/presentation-format";
import { formatTaskToken } from "@/lib/task-domain";

import type { HomeModel } from "../_lib/home-page-model";
import { HomeQuickActions } from "./home-quick-actions";

type HomeTask = NonNullable<HomeModel["startHere"]>;

function TaskContext({ projectName, goalTitle }: { projectName: string; goalTitle: string | null }) {
  return (
    <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
      {projectName}
      {goalTitle ? ` · ${goalTitle}` : ""}
    </p>
  );
}

function TaskMeta({ task }: { task: HomeTask }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={task.status} />
      {task.priority === "high" || task.priority === "urgent" ? (
        <Badge tone="warn">{formatTaskToken(task.priority)}</Badge>
      ) : null}
      {task.estimateMinutes ? <Badge tone="muted">{task.estimateMinutes}m</Badge> : null}
    </div>
  );
}

function ActiveTimerPanel({ model }: { model: HomeModel }) {
  const activeTimer = model.activeTimer;
  if (!activeTimer) return null;

  return (
    <Card data-testid="home-active-timer">
      <CardContent className="flex flex-col gap-3">
        <p className="glass-label inline-flex items-center gap-1.5 text-[color:var(--status-healthy)]">
          <Timer className="h-3.5 w-3.5" aria-hidden="true" />
          Focus running
        </p>
        <div>
          <h3 className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
            {activeTimer.task?.title ?? "Timer active"}
          </h3>
          {activeTimer.task ? (
            <div className="mt-1">
              <TaskContext
                projectName={activeTimer.task.projectName}
                goalTitle={activeTimer.task.goalTitle}
              />
            </div>
          ) : null}
        </div>
        {activeTimer.startedAt ? (
          <LiveDuration startedAt={activeTimer.startedAt} className="tabular-nums" />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/timer" className="btn-instrument flex h-8 items-center gap-2 px-3 text-sm">
            Open timer
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href="/tasks"
            className="btn-instrument btn-instrument-muted flex h-8 items-center gap-2 px-3 text-sm"
          >
            View tasks
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function StartHerePanel({ model }: { model: HomeModel }) {
  const task = model.startHere;

  if (!task) {
    return (
      <Card data-testid="home-start-here-empty">
        <CardContent className="flex flex-col gap-2">
          <p className="glass-label">Start here</p>
          <h3 className="text-[length:var(--text-panel-title)] font-semibold">
            Nothing queued right now
          </h3>
          <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
            Capture a thought or create a task and Home will have a first move for you.
          </p>
          <div className="mt-1"><HomeQuickActions /></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="home-start-here">
      <CardContent className="flex flex-col gap-3">
        <p className="glass-label text-[color:var(--status-healthy)]">Start here</p>
        <div>
          <h3 className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
            {task.title}
          </h3>
          {task.description ? (
            <p className="mt-1 max-w-[70ch] text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
              {task.description}
            </p>
          ) : null}
          <div className="mt-2">
            <TaskContext projectName={task.projectName} goalTitle={task.goalTitle} />
          </div>
        </div>
        <TaskMeta task={task} />
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/timer"
            className="btn-instrument flex h-8 items-center gap-2 px-3 text-sm"
            data-testid="home-open-timer"
          >
            <Timer className="h-4 w-4" aria-hidden="true" />
            Open timer
          </Link>
          <Link
            href="/tasks"
            className="btn-instrument btn-instrument-muted flex h-8 items-center gap-2 px-3 text-sm"
          >
            View details
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressPanel({ model }: { model: HomeModel }) {
  const summary = model.summary;
  if (!summary) return null;

  const queueTotal =
    summary.plannedCount + summary.inProgressCount + summary.completedCount;
  const ratio = queueTotal > 0 ? Math.round((summary.completedCount / queueTotal) * 100) : null;

  if (ratio === null) {
    return (
      <Card label="Today" title="Progress" data-testid="home-progress">
        <CardContent className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
            Nothing is planned for today yet.
          </p>
          <Link
            href="/today"
            className="text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]"
          >
            Plan today
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      label="Today"
      title="Progress"
      data-testid="home-progress"
    >
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[length:var(--text-metric)] font-semibold tabular-nums">
              {formatDisplayPercent(ratio)}
            </span>
            <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
              {summary.completedCount} of {queueTotal} today
            </span>
          </div>
          <ProgressBar
            value={ratio}
            max={100}
            size="md"
            label="Today's progress"
            valueText={`${ratio}% of today's planned work completed`}
          />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Planned today
            </dt>
            <dd className="tabular-nums text-[length:var(--text-body-lg)] font-semibold">
              {summary.plannedCount}
            </dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              In progress today
            </dt>
            <dd className="tabular-nums text-[length:var(--text-body-lg)] font-semibold">
              {summary.inProgressCount}
            </dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Planned effort
            </dt>
            <dd className="tabular-nums text-[length:var(--text-body-lg)] font-semibold">
              {summary.totalEstimateMinutes > 0
                ? formatDisplayEstimate(summary.totalEstimateMinutes)
                : "—"}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function FocusQueuePanel({ model }: { model: HomeModel }) {
  const queue = model.focusQueue
    .filter((task) => task.id !== model.startHere?.id)
    .slice(0, 5);

  return (
    <Card
      label="Queue"
      title="Up next"
      action={
        <Link
          href="/tasks"
          className="text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]"
        >
          View all
        </Link>
      }
      data-testid="home-focus-queue"
    >
      {queue.length === 0 ? (
        <CardContent>
          <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
            Nothing else queued right now.
          </p>
        </CardContent>
      ) : (
        <ul className="rows">
          {queue.map((task, index) => (
            <li key={task.id} className="row">
              <span
                className="w-4 shrink-0 tabular-nums text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span className="row-main">
                <span className="row-title">{task.title}</span>
                <span className="row-meta">
                  {task.projectName}
                  {task.dueDate ? ` · due ${formatDisplayDate(task.dueDate, "compact")}` : ""}
                </span>
              </span>
              {task.estimateMinutes ? (
                <span className="shrink-0 tabular-nums text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                  {formatDisplayEstimate(task.estimateMinutes)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AttentionPanel({ model }: { model: HomeModel }) {
  const { overdue, dueToday, reviewMissing } = model.attention;
  const clear = overdue === 0 && dueToday === 0 && !reviewMissing;

  return (
    <Card label="Signals" title="Needs attention" data-testid="home-attention">
      <CardContent className="flex flex-col gap-2">
        {overdue > 0 ? (
          <Link
            href="/tasks?due=overdue"
            className="row row-link"
          >
            <CircleAlert className="h-4 w-4 shrink-0 text-[color:var(--status-overdue)]" aria-hidden="true" />
            <span className="row-main">
              <span className="row-title">Overdue</span>
            </span>
            <span className="tabular-nums text-[length:var(--text-meta-lg)] font-medium text-[color:var(--status-overdue)]">
              {overdue}
            </span>
          </Link>
        ) : null}

        {dueToday > 0 ? (
          <Link
            href="/tasks?due=due_today"
            className="row row-link"
          >
            <CalendarCheck2 className="h-4 w-4 shrink-0 text-[color:var(--status-risk)]" aria-hidden="true" />
            <span className="row-main">
              <span className="row-title">Due today</span>
            </span>
            <span className="tabular-nums text-[length:var(--text-meta-lg)] font-medium text-[color:var(--status-risk)]">
              {dueToday}
            </span>
          </Link>
        ) : null}

        {reviewMissing ? (
          <Link
            href="/review"
            className="row row-link"
          >
            <ListChecks className="h-4 w-4 shrink-0 text-[color:var(--status-risk)]" aria-hidden="true" />
            <span className="row-main">
              <span className="row-title">Weekly review due</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]" aria-hidden="true" />
          </Link>
        ) : null}

        {clear ? (
          <p className="flex items-center gap-2 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
            <CheckCircle2 className="h-4 w-4 text-[color:var(--status-healthy)]" aria-hidden="true" />
            You&rsquo;re clear right now.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NextUpRow({ model }: { model: HomeModel }) {
  const task = model.nextUp;
  if (!task) return null;

  return (
    <Card data-testid="home-next-up">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 !py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Clock3 className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="glass-label">Next up</p>
            <p className="truncate text-[length:var(--text-body)] font-medium">{task.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <TaskContext projectName={task.projectName} goalTitle={task.goalTitle} />
          <Link
            href="/tasks"
            className="btn-instrument btn-instrument-muted flex h-8 items-center gap-2 px-3 text-sm"
          >
            Open tasks
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function DegradedNotice() {
  return (
    <div className="feedback-block feedback-block-warn" data-testid="home-degraded" role="status">
      <Flame className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        Suggested work and today&rsquo;s counts are unavailable right now. Quick actions still work.
      </p>
    </div>
  );
}

export function AuthenticatedHomePage({ model }: { model: HomeModel }) {
  const summary = model.summary;

  return (
    <div className="flex flex-col gap-8" data-testid="home-workspace">
      {model.snapshotUnavailable ? <DegradedNotice /> : null}

      <DashboardSection
        title="Daily execution overview"
        description="Today across due work, completed work, tracked focus, and overdue commitments."
      >
        <div className="kpi-grid">
          <StatCard
            label="Due today"
            value={model.attention.dueToday}
            subtitle="tasks due today"
            className="pt-2.5 pb-2.5 leading-snug"
          />
          <StatCard
            label="Completed"
            value={summary ? summary.completedCount : "—"}
            subtitle="tasks completed today"
            className="pt-2.5 pb-2.5 leading-snug"
          />
          <StatCard
            label="Focus time"
            value={summary ? summary.trackedTodayLabel : "—"}
            subtitle="time tracked today"
            className="pt-2.5 pb-2.5 leading-snug"
          />
          <StatCard
            label="Overdue"
            value={model.attention.overdue}
            subtitle="tasks past due"
            className="pt-2.5 pb-2.5 leading-snug"
          />
        </div>
      </DashboardSection>

      <DashboardSection
        title="Productivity and goals"
        description="How today is going, what to open next, and what needs attention."
      >
        <div className="workspace-main-rail-grid">
          <div className="flex flex-col gap-4">
            {model.activeTimer ? (
              <ActiveTimerPanel model={model} />
            ) : (
              <StartHerePanel model={model} />
            )}
            <ProgressPanel model={model} />
            <NextUpRow model={model} />
          </div>

          <div className="workspace-secondary-rail">
            <FocusQueuePanel model={model} />
            <AttentionPanel model={model} />
          </div>
        </div>
      </DashboardSection>
    </div>
  );
}
